// Tool execution dispatcher — runs the correct logic for each tool call
import {
  UUID_REGEX,
  VALID_CLIENT_STATUSES,
  VALID_CLIENT_TYPES,
  VALID_BUDGET_CURRENCIES,
  VALID_CONVERSATION_TYPES,
  normalizeClientStatus,
  resolveClientStatusForCreate,
  sanitizePattern,
  safePositiveNumber,
  safePositiveInt,
  safeDbError,
  normalizeDatetime,
  nextOccurrenceISO,
  todayCordobaISO,
  addDaysISO,
  wrapUntrustedWebContent,
  UNTRUSTED_WEB_NOTICE,
  rankProperties,
  neutralizeControlMarkers,
  sanitizeExternalPortalResult,
  normalizeOperation,
  stripChatMarkers,
} from "./validators.ts";
import {
  extractMeetLink,
  buildCalendarEvent,
  parseEventDates,
  buildMimeEmail,
} from "./google.ts";
import { CLIENT_EVENT_TYPES, CLIENT_EVENT_RECURRENCES } from "../alan-facts.ts";

export async function executeTool(
  name: string,
  args: any,
  ctx: {
    supabase: any;
    userId: string;
    conversationId: string;
    getCalendarToken: () => Promise<string | null>;
  }
): Promise<string> {
  const { supabase, userId, conversationId, getCalendarToken } = ctx;

  switch (name) {
    // ---- Properties ----
    case "search_properties": {
      // Strip diacritics so ILIKE matches data stored sans-tilde (zone/locality/neighborhood/city are stored without accents in BD).
      const stripAccents = (s: string | null) => s ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : s;
      const zone = stripAccents(sanitizePattern(args.zone));
      const locality = stripAccents(sanitizePattern(args.locality));
      const neighborhood = stripAccents(sanitizePattern(args.neighborhood));
      const city = stripAccents(sanitizePattern(args.city));
      const titleSearch = stripAccents(sanitizePattern(args.title));
      const operation = sanitizePattern(args.operation);
      const property_type = sanitizePattern(args.property_type);
      const currency = sanitizePattern(args.currency);
      const office = stripAccents(sanitizePattern(args.office));
      const min_price = safePositiveNumber(args.min_price);
      const max_price = safePositiveNumber(args.max_price);
      const min_ambientes = safePositiveInt(args.min_ambientes);
      const max_ambientes = safePositiveInt(args.max_ambientes);
      const min_habitaciones = safePositiveInt(args.min_habitaciones);
      const max_habitaciones = safePositiveInt(args.max_habitaciones);
      const limit = Math.min(Math.max(safePositiveInt(args.limit) ?? 5, 1), 50);
      // Traemos un POOL ordenado (created_at DESC) más grande que `limit` para poder
      // re-rankear Docta-first ANTES de truncar (ver rankProperties / ticket 86aj1f0ve).
      const POOL_FACTOR = 4;
      const poolLimit = Math.min(limit * POOL_FACTOR, 200);

      const applyFilters = (q: any, opts?: { skipLocality?: boolean; useLocalityAsTitle?: boolean; skipZone?: boolean; skipMaxPrice?: boolean; skipMinRooms?: boolean }) => {
        if (zone && !opts?.skipZone) q = q.ilike("zone", `%${zone}%`);
        if (locality && !opts?.skipLocality && !opts?.useLocalityAsTitle) q = q.ilike("locality", `%${locality}%`);
        if (locality && opts?.useLocalityAsTitle) q = q.ilike("title", `%${locality}%`);
        if (neighborhood) q = q.ilike("zone_neighborhood", `%${neighborhood}%`);
        if (city) q = q.ilike("zone_city", `%${city}%`);
        if (titleSearch) q = q.ilike("title", `%${titleSearch}%`);
        if (operation) {
          // Igualdad exacta cuando el término es un régimen canónico (Venta/Alquiler/Alquiler
          // temporario): así 'Alquiler' NO arrastra 'Alquiler temporario' (otro régimen legal).
          // Fallback al ILIKE substring para términos no reconocidos. Ver ticket 86aj1f1fy.
          const canonicalOp = normalizeOperation(operation);
          if (canonicalOp) q = q.eq("operation", canonicalOp);
          else q = q.ilike("operation", `%${operation}%`);
        }
        if (property_type) q = q.ilike("property_type", `%${property_type}%`);
        if (min_price !== null) q = q.gte("price", min_price);
        if (max_price !== null && !opts?.skipMaxPrice) q = q.lte("price", max_price);
        if (currency) q = q.ilike("currency", `%${currency}%`);
        if (min_ambientes !== null && !opts?.skipMinRooms) q = q.gte("ambientes", min_ambientes);
        if (max_ambientes !== null) q = q.lte("ambientes", max_ambientes);
        if (min_habitaciones !== null && !opts?.skipMinRooms) q = q.gte("habitaciones", min_habitaciones);
        if (max_habitaciones !== null) q = q.lte("habitaciones", max_habitaciones);
        if (office) q = q.ilike("office", `%${office}%`);
        return q;
      };

      // Primary search. La query de datos trae un pool ordenado; la de count queda intacta
      // (head:true → total_count real del universo, sin order ni pool).
      let baseQuery = applyFilters(supabase.from("properties").select("*", { count: "exact", head: true }));
      let dataQuery = applyFilters(supabase.from("properties").select("*")).order("created_at", { ascending: false }).limit(poolLimit);

      const [countResult, dataResult] = await Promise.all([baseQuery, dataQuery]);
      let totalCount = countResult.count ?? 0;
      let data = dataResult.data;
      let error = dataResult.error;
      // Cuando los resultados provienen de un reintento por título (no por zona/localidad exacta),
      // lo etiquetamos para que Alan lo aclare en vez de presentarlo como match exacto. Ver 86aj1f1w6.
      let titleFallbackTerm: string | null = null;

      // Fallback: if locality was provided but got 0 results, retry searching in title
      if (!error && (!data || data.length === 0) && locality && !titleSearch) {
        const fbBase = applyFilters(
          supabase.from("properties").select("*", { count: "exact", head: true }),
          { useLocalityAsTitle: true }
        );
        const fbData = applyFilters(
          supabase.from("properties").select("*"),
          { useLocalityAsTitle: true }
        ).order("created_at", { ascending: false }).limit(poolLimit);
        const [fbCountRes, fbDataRes] = await Promise.all([fbBase, fbData]);
        if (!fbDataRes.error && fbDataRes.data && fbDataRes.data.length > 0) {
          totalCount = fbCountRes.count ?? 0;
          data = fbDataRes.data;
          error = fbDataRes.error;
          titleFallbackTerm = locality;
        }
      }

      // Fallback: if neighborhood was provided but got 0 results, retry in title
      if (!error && (!data || data.length === 0) && neighborhood && !titleSearch && !locality) {
        const fbBase2 = applyFilters(
          supabase.from("properties").select("*", { count: "exact", head: true }),
          { useLocalityAsTitle: true }
        );
        const fbData2 = applyFilters(
          supabase.from("properties").select("*"),
          { useLocalityAsTitle: true }
        ).order("created_at", { ascending: false }).limit(poolLimit);
        // For this fallback, search neighborhood term in title
        const [fbCountRes2, fbDataRes2] = await Promise.all([
          fbBase2.ilike("title", `%${neighborhood}%`),
          fbData2.ilike("title", `%${neighborhood}%`),
        ]);
        if (!fbDataRes2.error && fbDataRes2.data && fbDataRes2.data.length > 0) {
          totalCount = fbCountRes2.count ?? 0;
          data = fbDataRes2.data;
          error = fbDataRes2.error;
          titleFallbackTerm = neighborhood;
        }
      }

      // Fallback: zona provista sin resultados → el término puede ser un desarrollo/loteo
      // cuyo nombre vive en el título (no en el campo zone). Reintentamos buscándolo en title.
      if (!error && (!data || data.length === 0) && zone && !titleSearch && !locality && !neighborhood) {
        const fbBaseZ = applyFilters(
          supabase.from("properties").select("*", { count: "exact", head: true }),
          { skipZone: true }
        ).ilike("title", `%${zone}%`);
        const fbDataZ = applyFilters(
          supabase.from("properties").select("*"),
          { skipZone: true }
        ).ilike("title", `%${zone}%`).order("created_at", { ascending: false }).limit(poolLimit);
        const [fbCountResZ, fbDataResZ] = await Promise.all([fbBaseZ, fbDataZ]);
        if (!fbDataResZ.error && fbDataResZ.data && fbDataResZ.data.length > 0) {
          totalCount = fbCountResZ.count ?? 0;
          data = fbDataResZ.data;
          error = fbDataResZ.error;
          titleFallbackTerm = zone;
        }
      }

      if (error) return JSON.stringify({ error: safeDbError(error) });
      if (!data || data.length === 0) {
        // 0 resultados: si había al menos un filtro numérico, reintentamos 1-2 counts `exact`
        // relajando el filtro más probable (primero max_price, después min_habitaciones/ambientes)
        // para que Alan ofrezca una relajación concreta ("hay N opciones si subís ~15%").
        // Solo devolvemos hints con count>0. Ver ticket 86aj1f1fy.
        const hasNumericFilter = [min_price, max_price, min_ambientes, max_ambientes, min_habitaciones, max_habitaciones].some((v) => v !== null);
        const relax_hints: Array<{ drop: string; count: number }> = [];
        if (hasNumericFilter) {
          if (max_price !== null) {
            const { count } = await applyFilters(supabase.from("properties").select("*", { count: "exact", head: true }), { skipMaxPrice: true });
            if ((count ?? 0) > 0) relax_hints.push({ drop: "max_price", count: count ?? 0 });
          }
          if (min_habitaciones !== null || min_ambientes !== null) {
            const { count } = await applyFilters(supabase.from("properties").select("*", { count: "exact", head: true }), { skipMinRooms: true });
            if ((count ?? 0) > 0) relax_hints.push({ drop: min_habitaciones !== null ? "min_habitaciones" : "min_ambientes", count: count ?? 0 });
          }
        }
        return JSON.stringify({ message: "No se encontraron propiedades con esos criterios.", total_count: 0, results: [], ...(relax_hints.length ? { relax_hints } : {}) });
      }

      // Re-rankeamos el pool Docta-first y recién ahí truncamos a `limit`: una Docta fuera
      // de la ventana de los más nuevos puede subir a la página visible. total_count sigue
      // siendo el universo real (count head:true); `showing` es el slice final.
      const ranked = rankProperties(data, limit);
      const doctaCount = ranked.filter((p: any) => p.office?.toLowerCase().includes("docta")).length;

      return JSON.stringify({
        total_count: totalCount,
        showing: ranked.length,
        docta_in_results: doctaCount,
        results: ranked,
        ...(titleFallbackTerm ? { match_mode: "title_fallback", searched_term: titleFallbackTerm } : {}),
      });
    }

    case "compare_properties": {
      if (!Array.isArray(args.property_ids) || args.property_ids.length === 0) {
        return JSON.stringify({ error: "IDs de propiedades inválidos" });
      }
      const validIds = args.property_ids.filter((id: unknown) => typeof id === "string" && UUID_REGEX.test(id));
      if (validIds.length === 0) return JSON.stringify({ error: "IDs de propiedades inválidos" });
      const { data, error } = await supabase.from("properties").select("*").in("id", validIds);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ properties: data, instruction: "Compará estas propiedades en una tabla markdown con las dimensiones: precio, m² totales, habitaciones, baños, zona/ubicación y precio por m² ($/m², calculalo cuando tengas precio y m²). Resaltá la mejor opción por criterio para ayudar al agente a manejar objeciones con datos." });
    }

    // ---- Favorites ----
    case "get_favorites": {
      const { data, error } = await supabase
        .from("favorites")
        .select("property_id, properties(*)")
        .eq("user_id", userId);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ favorites: data });
    }

    case "add_favorite": {
      if (!args.property_id || !UUID_REGEX.test(args.property_id)) {
        return JSON.stringify({ error: "ID de propiedad inválido" });
      }
      const { error } = await supabase.from("favorites").insert({ user_id: userId, property_id: args.property_id });
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, message: "Propiedad agregada a favoritos" });
    }

    case "remove_favorite": {
      if (!args.property_id || !UUID_REGEX.test(args.property_id)) {
        return JSON.stringify({ error: "ID de propiedad inválido" });
      }
      const { error } = await supabase.from("favorites").delete().eq("user_id", userId).eq("property_id", args.property_id);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, message: "Propiedad eliminada de favoritos" });
    }

    case "generate_report": {
      if (!args.property_id || !UUID_REGEX.test(args.property_id)) {
        return JSON.stringify({ error: "ID de propiedad inválido" });
      }
      const { data, error } = await supabase.from("properties").select("*").eq("id", args.property_id).single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ property: data, instruction: "Generá una ficha profesional y detallada de esta propiedad para compartir con el cliente, en PROSA organizada (NO tarjeta con emojis 🏠💰📍). Envolvé TODA la ficha entre <<<DRAFT_START>>> y <<<DRAFT_END>>> (cada marcador solo en su línea) para que sea un texto copiable. Incluí el link de la propiedad con la atribución ?associate." });
    }

    // ---- Clients ----
    case "create_client": {
      const full_name = typeof args.full_name === "string" ? args.full_name.trim().slice(0, 200) : null;
      if (!full_name) return JSON.stringify({ error: "El nombre es requerido" });
      const phone = typeof args.phone === "string" ? args.phone.trim().slice(0, 50) : null;
      const email = typeof args.email === "string" ? args.email.trim().slice(0, 200) : null;
      const notes = typeof args.notes === "string" ? args.notes.trim().slice(0, 2000) : null;
      const status = resolveClientStatusForCreate(args.status);
      const client_type = VALID_CLIENT_TYPES.includes(args.client_type) ? args.client_type : "buyer";
      const birthday = typeof args.birthday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.birthday) ? args.birthday : null;
      const company = typeof args.company === "string" ? args.company.trim().slice(0, 100) : null;
      const address = typeof args.address === "string" ? args.address.trim().slice(0, 200) : null;
      const preferred_zones = typeof args.preferred_zones === "string" ? args.preferred_zones.trim().slice(0, 300) : null;
      const budget_min = safePositiveNumber(args.budget_min);
      const budget_max = safePositiveNumber(args.budget_max);
      const budget_currency = VALID_BUDGET_CURRENCIES.includes(args.budget_currency) ? args.budget_currency : "USD";
      const property_type_interest = typeof args.property_type_interest === "string" ? args.property_type_interest.trim().slice(0, 200) : null;
      const source = typeof args.source === "string" ? args.source.trim().slice(0, 100) : null;
      const { data, error } = await supabase
        .from("clients")
        .insert({ user_id: userId, full_name, phone, email, notes, status, client_type, birthday, company, address, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, source, is_client: true })
        .select("id, full_name, status, client_type")
        .single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, client: data, message: `Cliente "${full_name}" creado correctamente.` });
    }

    case "update_client": {
      if (!args.client_id || !UUID_REGEX.test(args.client_id)) return JSON.stringify({ error: "ID de cliente inválido" });
      const updates: Record<string, any> = {};
      if (typeof args.full_name === "string") updates.full_name = args.full_name.trim().slice(0, 200);
      if (typeof args.phone === "string") updates.phone = args.phone.trim().slice(0, 50);
      if (typeof args.email === "string") updates.email = args.email.trim().slice(0, 200);
      if (typeof args.notes === "string") updates.notes = args.notes.trim().slice(0, 2000);
      const normalizedStatus = normalizeClientStatus(args.status);
      if (normalizedStatus) updates.status = normalizedStatus;
      if (VALID_CLIENT_TYPES.includes(args.client_type)) updates.client_type = args.client_type;
      if (typeof args.birthday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.birthday)) updates.birthday = args.birthday;
      if (typeof args.company === "string") updates.company = args.company.trim().slice(0, 100);
      if (typeof args.address === "string") updates.address = args.address.trim().slice(0, 200);
      if (typeof args.preferred_zones === "string") updates.preferred_zones = args.preferred_zones.trim().slice(0, 300);
      const budgetMinUpd = safePositiveNumber(args.budget_min);
      if (budgetMinUpd !== null) updates.budget_min = budgetMinUpd;
      const budgetMaxUpd = safePositiveNumber(args.budget_max);
      if (budgetMaxUpd !== null) updates.budget_max = budgetMaxUpd;
      if (VALID_BUDGET_CURRENCIES.includes(args.budget_currency)) updates.budget_currency = args.budget_currency;
      if (typeof args.property_type_interest === "string") updates.property_type_interest = args.property_type_interest.trim().slice(0, 200);
      if (typeof args.source === "string") updates.source = args.source.trim().slice(0, 100);
      if (Object.keys(updates).length === 0) return JSON.stringify({ error: "No hay campos para actualizar" });
      const { data, error } = await supabase
        .from("clients")
        .update(updates)
        .eq("id", args.client_id)
        .eq("user_id", userId)
        .select("id, full_name, status, client_type")
        .single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, client: data, message: `Cliente actualizado correctamente.` });
    }

    case "list_clients": {
      const search = sanitizePattern(args.search);
      const status = VALID_CLIENT_STATUSES.includes(args.status) ? args.status : null;
      const limit = Math.min(Math.max(safePositiveInt(args.limit) ?? 20, 1), 100);
      let query = supabase
        .from("clients")
        .select("id, full_name, phone, email, status, client_type, notes, birthday, company, address, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, source, created_at, updated_at")
        .eq("user_id", userId)
        .eq("is_client", true)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (search) query = query.ilike("full_name", `%${search}%`);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ clients: data ?? [], total: data?.length ?? 0 });
    }

    case "get_client": {
      if (!args.client_id || !UUID_REGEX.test(args.client_id)) return JSON.stringify({ error: "ID de cliente inválido" });
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("id", args.client_id)
        .eq("user_id", userId)
        .eq("is_client", true)
        .single();
      if (clientError) return JSON.stringify({ error: safeDbError(clientError) });
      // Ficha 360: además de conversaciones y propiedades, traemos tareas pendientes y
      // próximos eventos para que afloren sin encadenar tool-calls. Todo scopeado por user_id.
      // Ver ticket 86aj1f0y3.
      const [{ data: convs }, { data: clientProps }, { data: pendingNotes }, { data: eventsRaw }] = await Promise.all([
        supabase
          .from("conversations")
          .select("id, title, conversation_type, updated_at")
          .eq("client_id", args.client_id)
          .eq("user_id", userId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("client_properties")
          .select("id, property_id, status, notes, created_at, properties(title, address, price, currency, url, photo, operation, property_type)")
          .eq("client_id", args.client_id)
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        supabase
          .from("client_notes")
          .select("id, content, is_action, is_done, created_at")
          .eq("client_id", args.client_id)
          .eq("user_id", userId)
          .eq("is_done", false)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("client_events")
          .select("id, event_type, title, event_date, recurrence, google_event_id, notes")
          .eq("client_id", args.client_id)
          .eq("user_id", userId)
          .order("event_date", { ascending: true }),
      ]);

      // Próximos 90 días, considerando recurrencia (misma semántica que list_client_events).
      const todayISO = todayCordobaISO();
      const cutoffISO = addDaysISO(todayISO, 90);
      const upcoming_events = (eventsRaw ?? [])
        .map((ev: any) => ({ ...ev, next_occurrence: nextOccurrenceISO(ev.event_date, ev.recurrence, todayISO) }))
        .filter((ev: any) => ev.next_occurrence >= todayISO && ev.next_occurrence <= cutoffISO)
        .sort((a: any, b: any) => a.next_occurrence.localeCompare(b.next_occurrence));

      return JSON.stringify({ client, conversations: convs ?? [], properties: clientProps ?? [], pending_notes: pendingNotes ?? [], upcoming_events });
    }

    case "link_conversation": {
      if (!conversationId || !UUID_REGEX.test(conversationId)) return JSON.stringify({ error: "ID de conversación inválido" });
      const updates: Record<string, any> = {};
      if (args.client_id && UUID_REGEX.test(args.client_id)) {
        const { data: client } = await supabase.from("clients").select("id").eq("id", args.client_id).eq("user_id", userId).single();
        if (client) updates.client_id = args.client_id;
      }
      if (VALID_CONVERSATION_TYPES.includes(args.conversation_type)) updates.conversation_type = args.conversation_type;
      if (Object.keys(updates).length === 0) return JSON.stringify({ error: "No hay datos para vincular" });
      const { error } = await supabase.from("conversations").update(updates).eq("id", conversationId).eq("user_id", userId);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, message: "Conversación vinculada correctamente." });
    }

    // ---- Calendar ----
    case "create_calendar_event": {
      const accessToken = await getCalendarToken();
      if (!accessToken) return JSON.stringify({ error: "Google Calendar no conectado. El agente debe ir a su perfil y conectar el calendario." });

      const summary = typeof args.summary === "string" ? args.summary.trim().slice(0, 500) : null;
      if (!summary) return JSON.stringify({ error: "El título del evento es requerido" });

      const dates = parseEventDates(args);
      if ("error" in dates) return JSON.stringify({ error: dates.error });

      const eventBody = buildCalendarEvent({
        summary,
        startDate: dates.startDate,
        endDate: dates.endDate,
        description: args.description,
        location: args.location,
        addMeet: args.add_meet_link === true,
      });

      const calUrl = args.add_meet_link === true
        ? "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1"
        : "https://www.googleapis.com/calendar/v3/calendars/primary/events";

      const calRes = await fetch(calUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(eventBody),
      });
      if (!calRes.ok) {
        const err = await calRes.text();
        console.error("Calendar create error:", err);
        return JSON.stringify({ error: "Error al crear el evento en Google Calendar" });
      }
      const event = await calRes.json();
      return JSON.stringify({ success: true, event_id: event.id, html_link: event.htmlLink, meet_link: extractMeetLink(event), message: `Evento "${summary}" creado correctamente en Google Calendar.` });
    }

    case "create_meet_event": {
      const accessToken = await getCalendarToken();
      if (!accessToken) return JSON.stringify({ error: "Google Calendar no conectado. El agente debe ir a su perfil y conectar el calendario." });

      const summary = typeof args.summary === "string" ? args.summary.trim().slice(0, 500) : null;
      if (!summary) return JSON.stringify({ error: "El título del evento es requerido" });

      const dates = parseEventDates(args);
      if ("error" in dates) return JSON.stringify({ error: dates.error });

      const eventBody = buildCalendarEvent({
        summary,
        startDate: dates.startDate,
        endDate: dates.endDate,
        description: args.description,
        addMeet: true,
        attendees: Array.isArray(args.attendees) ? args.attendees : undefined,
      });

      const calRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(eventBody),
      });
      if (!calRes.ok) {
        const err = await calRes.text();
        console.error("Meet event create error:", err);
        return JSON.stringify({ error: "Error al crear el evento con Google Meet" });
      }
      const event = await calRes.json();
      return JSON.stringify({ success: true, event_id: event.id, html_link: event.htmlLink, meet_link: extractMeetLink(event), start: dates.startDate.toISOString(), end: dates.endDate.toISOString(), message: `Reunión por Meet "${summary}" creada correctamente.` });
    }

    // ---- Gmail ----
    case "send_email": {
      // try/catch propio (alineado con web_search/scrape_url): un throw transitorio acá NO debe
      // tumbar el turno; devolvemos un error útil para que el modelo avise/reintente. Ver 86aj1ncj4.
      let accessToken: string | null;
      try {
        accessToken = await getCalendarToken();
      } catch (err) {
        console.error("send_email getCalendarToken error:", err);
        return JSON.stringify({ error: "No pude validar la conexión con Gmail (error transitorio). Reintentá en un momento." });
      }
      if (!accessToken) return JSON.stringify({ error: "Gmail no conectado. El agente debe reconectar su cuenta desde el perfil para activar el envío de emails." });

      const to = typeof args.to === "string" ? args.to.trim().slice(0, 500) : null;
      if (!to || !to.includes("@")) return JSON.stringify({ error: "Email de destinatario inválido" });
      const subject = typeof args.subject === "string" ? args.subject.trim().slice(0, 500) : null;
      if (!subject) return JSON.stringify({ error: "El asunto es requerido" });
      const rawBody = typeof args.body === "string" ? args.body.trim().slice(0, 50000) : null;
      if (!rawBody) return JSON.stringify({ error: "El cuerpo del email es requerido" });
      // Garantía server-side: strippeamos los marcadores de chat (DRAFT/WHATSAPP_TO/MSG_BREAK)
      // para que NUNCA lleguen al email real del cliente, aunque el modelo los filtre. Ver 86aj1f236.
      const body = stripChatMarkers(rawBody);
      if (!body) return JSON.stringify({ error: "El cuerpo del email es requerido" });
      const cc = typeof args.cc === "string" ? args.cc.trim().slice(0, 500) : null;

      const encoded = buildMimeEmail(to, subject, body, cc);

      let gmailRes: Response;
      try {
        gmailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw: encoded }),
        });
      } catch (err) {
        console.error("send_email Gmail fetch error:", err);
        return JSON.stringify({ error: "Error de red al enviar el email. El email NO se envió; reintentá en un momento." });
      }

      if (!gmailRes.ok) {
        const err = await gmailRes.text();
        console.error("Gmail send error:", err);
        if (gmailRes.status === 403) return JSON.stringify({ error: "Sin permisos para enviar emails. El agente debe reconectar su cuenta desde el perfil para activar Gmail." });
        return JSON.stringify({ error: "Error al enviar el email" });
      }
      const gmailData = await gmailRes.json();
      return JSON.stringify({ success: true, message_id: gmailData.id, message: `Email enviado correctamente a ${to}.` });
    }

    case "list_calendar_events": {
      const accessToken = await getCalendarToken();
      if (!accessToken) return JSON.stringify({ error: "Google Calendar no conectado." });

      const daysAhead = Math.min(Math.max(safePositiveInt(args.days_ahead) ?? 7, 1), 30);
      const maxResults = Math.min(Math.max(safePositiveInt(args.max_results) ?? 10, 1), 20);
      const params = new URLSearchParams({
        timeMin: new Date().toISOString(),
        timeMax: new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString(),
        maxResults: String(maxResults),
        singleEvents: "true",
        orderBy: "startTime",
      });

      const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!calRes.ok) return JSON.stringify({ error: "Error al obtener eventos de Google Calendar" });
      const data = await calRes.json();
      const events = (data.items ?? []).map((e: any) => ({
        id: e.id,
        summary: e.summary,
        description: e.description,
        location: e.location,
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
        html_link: e.htmlLink,
        meet_link: extractMeetLink(e),
      }));
      return JSON.stringify({ events, total: events.length });
    }

    case "update_calendar_event": {
      const accessToken = await getCalendarToken();
      if (!accessToken) return JSON.stringify({ error: "Google Calendar no conectado." });

      const eventId = typeof args.event_id === "string" ? args.event_id.trim() : null;
      if (!eventId) return JSON.stringify({ error: "ID de evento requerido" });

      const getRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!getRes.ok) return JSON.stringify({ error: "Evento no encontrado" });
      await getRes.json(); // consume body

      const patch: any = {};
      if (args.summary) patch.summary = String(args.summary).slice(0, 500);
      if (args.description !== undefined) patch.description = String(args.description).slice(0, 2000);
      if (args.location !== undefined) patch.location = String(args.location).slice(0, 500);
      if (args.start_datetime) {
        const sd = normalizeDatetime(String(args.start_datetime));
        if (sd) patch.start = { dateTime: sd.toISOString(), timeZone: "America/Argentina/Cordoba" };
      }
      if (args.end_datetime) {
        const ed = normalizeDatetime(String(args.end_datetime));
        if (ed) patch.end = { dateTime: ed.toISOString(), timeZone: "America/Argentina/Cordoba" };
      }

      const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!patchRes.ok) return JSON.stringify({ error: "Error al actualizar el evento" });
      const updated = await patchRes.json();
      return JSON.stringify({ success: true, event_id: updated.id, html_link: updated.htmlLink, message: `Evento actualizado correctamente.` });
    }

    case "delete_calendar_event": {
      const accessToken = await getCalendarToken();
      if (!accessToken) return JSON.stringify({ error: "Google Calendar no conectado." });

      const eventId = typeof args.event_id === "string" ? args.event_id.trim() : null;
      if (!eventId) return JSON.stringify({ error: "ID de evento requerido" });

      const delRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!delRes.ok && delRes.status !== 410) return JSON.stringify({ error: "Error al eliminar el evento" });
      return JSON.stringify({ success: true, message: "Evento eliminado del calendario." });
    }

    // ---- Web Search & Scraping (Firecrawl) ----
    case "web_search": {
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (!firecrawlKey) return JSON.stringify({ error: "Búsqueda web no configurada." });
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : null;
      if (!query) return JSON.stringify({ error: "La consulta de búsqueda es requerida" });
      const limit = Math.min(Math.max(safePositiveInt(args.limit) ?? 5, 1), 10);
      try {
        const res = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query, limit, scrapeOptions: { formats: ["markdown"] } }),
        });
        if (!res.ok) {
          const err = await res.text();
          console.error("Firecrawl search error:", err);
          return JSON.stringify({ error: "Error al buscar en internet" });
        }
        const data = await res.json();
        const results = (data.data ?? []).map((r: any) => ({
          title: r.title,
          url: r.url,
          description: r.description,
          content: r.markdown ? wrapUntrustedWebContent(r.markdown.slice(0, 2000)) : "",
        }));
        return JSON.stringify({ untrusted_content_notice: UNTRUSTED_WEB_NOTICE, results, total: results.length });
      } catch (e) {
        console.error("Web search error:", e);
        return JSON.stringify({ error: "Error al buscar en internet" });
      }
    }

    case "scrape_url": {
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (!firecrawlKey) return JSON.stringify({ error: "Scraping web no configurado." });
      let url = typeof args.url === "string" ? args.url.trim() : null;
      if (!url) return JSON.stringify({ error: "La URL es requerida" });
      if (!url.startsWith("http://") && !url.startsWith("https://")) url = `https://${url}`;
      try {
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        });
        if (!res.ok) {
          const err = await res.text();
          console.error("Firecrawl scrape error:", err);
          return JSON.stringify({ error: "Error al leer la página web" });
        }
        const data = await res.json();
        const content = data.data?.markdown || data.markdown || "";
        const metadata = data.data?.metadata || data.metadata || {};
        return JSON.stringify({
          title: metadata.title || "",
          url: metadata.sourceURL || url,
          untrusted_content_notice: UNTRUSTED_WEB_NOTICE,
          content: wrapUntrustedWebContent(content.slice(0, 8000)),
        });
      } catch (e) {
        console.error("Scrape error:", e);
        return JSON.stringify({ error: "Error al leer la página web" });
      }
    }

    // ---- External Portal Search (ZonaProp & ArgenProp) ----
    case "search_external_portals": {
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (!firecrawlKey) return JSON.stringify({ error: "Búsqueda en portales externos no configurada." });
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : null;
      if (!query) return JSON.stringify({ error: "La consulta de búsqueda es requerida" });

      const portals: string[] = Array.isArray(args.portals) && args.portals.length > 0
        ? args.portals.map((p: string) => String(p).toLowerCase())
        : ["zonaprop", "argenprop"];

      const operation = typeof args.operation === "string" ? args.operation.trim().toLowerCase() : "";
      const propertyType = typeof args.property_type === "string" ? args.property_type.trim().toLowerCase() : "";
      // location puede venir como slug ("nueva-cordoba") o con espacios; para el query libre
      // de Firecrawl lo queremos con espacios. (Antes se calculaba pero quedaba muerto.)
      const location = typeof args.location === "string"
        ? args.location.trim().toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim()
        : "";

      // Build search URLs for each portal - fixed Córdoba URLs
      const portalSearchUrls: Record<string, string | string[]> = {};

      if (portals.includes("zonaprop")) {
        if (operation === "alquiler") {
          portalSearchUrls.zonaprop = "https://www.zonaprop.com.ar/inmuebles-alquiler-cordoba.html";
        } else if (operation === "venta") {
          portalSearchUrls.zonaprop = "https://www.zonaprop.com.ar/inmuebles-venta-cordoba.html";
        } else if (operation === "temporal" || operation === "alquiler temporal" || operation === "alquiler-temporal") {
          portalSearchUrls.zonaprop = "https://www.zonaprop.com.ar/inmuebles-alquiler-temporal-cordoba.html";
        } else {
          portalSearchUrls.zonaprop = [
            "https://www.zonaprop.com.ar/inmuebles-alquiler-cordoba.html",
            "https://www.zonaprop.com.ar/inmuebles-venta-cordoba.html",
            "https://www.zonaprop.com.ar/inmuebles-alquiler-temporal-cordoba.html",
          ];
        }
      }
      if (portals.includes("argenprop")) {
        portalSearchUrls.argenprop = "https://www.argenprop.com/campos-o-casas-o-cocheras-o-departamentos-o-fondos-de-comercio-o-galpones-o-hoteles-o-locales-o-negocios-especiales-o-oficinas-o-ph-o-quintas-o-terrenos/alquiler-o-alquiler-temporal-o-venta/cordoba-arg";
      }

      // Use Firecrawl search with site: filters
      const allResults: Array<{ portal: string; title: string; url: string; description: string }> = [];

      const searchPromises = portals.map(async (portal) => {
        const siteDomain = portal === "zonaprop" ? "zonaprop.com.ar" : "argenprop.com";
        // Inyectamos tipo y ubicación (antes ignorados → buscaba cualquier cosa en Córdoba).
        const searchQuery = [`site:${siteDomain}`, "cordoba", location, propertyType, query, operation]
          .filter(Boolean)
          .join(" ");
        try {
          const res = await fetch("https://api.firecrawl.dev/v1/search", {
            method: "POST",
            headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ query: searchQuery, limit: 5 }),
          });
          if (!res.ok) {
            console.error(`Firecrawl search error for ${portal}:`, await res.text());
            return;
          }
          const data = await res.json();
          const results = (data.data ?? []).filter((r: any) => r.url && r.url.includes(siteDomain));
          for (const r of results) {
            // title/description son contenido externo no confiable: neutralizamos los
            // marcadores de control para que no inyecten burbujas/botones falsos.
            allResults.push(sanitizeExternalPortalResult(r, portal === "zonaprop" ? "ZonaProp" : "ArgenProp"));
          }
        } catch (e) {
          console.error(`Error searching ${portal}:`, e);
        }
      });

      await Promise.all(searchPromises);

      return JSON.stringify({
        untrusted_content_notice: UNTRUSTED_WEB_NOTICE,
        results: allResults,
        total: allResults.length,
        search_urls: portalSearchUrls,
        message: allResults.length > 0
          ? `Encontré ${allResults.length} propiedades en portales externos.`
          : "No encontré propiedades en los portales externos con esos criterios. Podés probar en los links de búsqueda directa.",
      });
    }

    // ---- Client Properties ----
    case "save_property_to_client": {
      // Resolve client: accept client_id or client_name
      let resolvedClientId = args.client_id;
      if (!resolvedClientId || !UUID_REGEX.test(resolvedClientId)) {
        if (!args.client_name) return JSON.stringify({ error: "Necesito el nombre o ID del cliente." });
        const searchName = sanitizePattern(args.client_name);
        const { data: clients } = await supabase.from("clients").select("id, full_name").eq("user_id", userId).eq("is_client", true).ilike("full_name", `%${searchName}%`).limit(5);
        if (!clients || clients.length === 0) return JSON.stringify({ error: `No encontré un cliente con el nombre "${args.client_name}".` });
        if (clients.length > 1) return JSON.stringify({ error: `Encontré ${clients.length} clientes: ${clients.map(c => c.full_name).join(", ")}. ¿Cuál querés?`, clients });
        resolvedClientId = clients[0].id;
      }
      // Resolve property: accept property_id or property_title
      let resolvedPropertyId = args.property_id;
      if (!resolvedPropertyId || !UUID_REGEX.test(resolvedPropertyId)) {
        if (!args.property_title) return JSON.stringify({ error: "Necesito el título/dirección o ID de la propiedad." });
        const searchTitle = sanitizePattern(args.property_title);
        const pattern = `%${searchTitle}%`;
        // OR (title|address) con filtros parametrizados en vez de interpolar el string de .or():
        // un .ilike() de columna única pasa el valor como parámetro y no parsea comas/paréntesis,
        // así que no se pueden inyectar condiciones de filtro (ej. "x,user_id.eq.…").
        const [byTitle, byAddress] = await Promise.all([
          supabase.from("properties").select("id, title, address").ilike("title", pattern).limit(5),
          supabase.from("properties").select("id, title, address").ilike("address", pattern).limit(5),
        ]);
        const seen = new Set<string>();
        const props: Array<{ id: string; title: string | null; address: string | null }> = [];
        for (const p of [...(byTitle.data ?? []), ...(byAddress.data ?? [])]) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          props.push(p);
          if (props.length >= 5) break;
        }
        if (props.length === 0) return JSON.stringify({ error: `No encontré una propiedad con "${args.property_title}".` });
        if (props.length > 1) return JSON.stringify({ error: `Encontré ${props.length} propiedades similares: ${props.map(p => p.title || p.address).join(", ")}. ¿Cuál querés vincular?`, properties: props });
        resolvedPropertyId = props[0].id;
      }
      const validStatuses = ["sugerida", "enviada", "visitada", "descartada"];
      const status = validStatuses.includes(args.status) ? args.status : "sugerida";
      const notes = typeof args.notes === "string" ? args.notes.trim().slice(0, 2000) : null;
      // Verify client belongs to user
      const { data: client } = await supabase.from("clients").select("id, full_name").eq("id", resolvedClientId).eq("user_id", userId).eq("is_client", true).maybeSingle();
      if (!client) return JSON.stringify({ error: "Cliente no encontrado o no te pertenece." });
      const { data, error } = await supabase
        .from("client_properties")
        .upsert({ user_id: userId, client_id: resolvedClientId, property_id: resolvedPropertyId, status, notes }, { onConflict: "client_id,property_id" })
        .select("id")
        .maybeSingle();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      // 'enviada' = contacto saliente real → registramos last_contact_at para que el panel
      // "clientes sin contactar" del dashboard use la señal real y no updated_at (que cambia
      // con cualquier edición). Scopeado por userId. Ver ticket 86aj1f0wj.
      if (status === "enviada") {
        await supabase.from("clients").update({ last_contact_at: new Date().toISOString() }).eq("id", resolvedClientId).eq("user_id", userId);
      }
      return JSON.stringify({ success: true, message: `Propiedad guardada en el perfil de ${client.full_name} (estado: ${status}).` });
    }

    case "list_client_properties": {
      if (!args.client_id || !UUID_REGEX.test(args.client_id)) return JSON.stringify({ error: "ID de cliente inválido" });
      const validStatuses = ["sugerida", "enviada", "visitada", "descartada"];
      let query = supabase
        .from("client_properties")
        .select("id, property_id, status, notes, created_at, properties(*)")
        .eq("client_id", args.client_id)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (args.status && validStatuses.includes(args.status)) query = query.eq("status", args.status);
      const { data, error } = await query;
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ client_properties: data ?? [], total: data?.length ?? 0 });
    }

    case "remove_client_property": {
      if (!args.client_id || !UUID_REGEX.test(args.client_id)) return JSON.stringify({ error: "ID de cliente inválido" });
      if (!args.property_id || !UUID_REGEX.test(args.property_id)) return JSON.stringify({ error: "ID de propiedad inválido" });
      const { error } = await supabase
        .from("client_properties")
        .delete()
        .eq("client_id", args.client_id)
        .eq("property_id", args.property_id)
        .eq("user_id", userId);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, message: "Propiedad desvinculada del cliente." });
    }

    case "update_client_property": {
      // Acepta client_id/property_id directos o client_name/property_title (mismo patrón de
      // resolución que save_property_to_client). Así Alan puede mover el estado sin tener IDs
      // a mano. Ver ticket 86aj1f1bb. Scoping por user_id se preserva en la query de update.
      let resolvedClientId = args.client_id;
      if (!resolvedClientId || !UUID_REGEX.test(resolvedClientId)) {
        if (!args.client_name) return JSON.stringify({ error: "Necesito el nombre o ID del cliente." });
        const searchName = sanitizePattern(args.client_name);
        const { data: clients } = await supabase.from("clients").select("id, full_name").eq("user_id", userId).eq("is_client", true).ilike("full_name", `%${searchName}%`).limit(5);
        if (!clients || clients.length === 0) return JSON.stringify({ error: `No encontré un cliente con el nombre "${args.client_name}".` });
        if (clients.length > 1) return JSON.stringify({ error: `Encontré ${clients.length} clientes: ${clients.map((c) => c.full_name).join(", ")}. ¿Cuál querés?`, clients });
        resolvedClientId = clients[0].id;
      }
      let resolvedPropertyId = args.property_id;
      if (!resolvedPropertyId || !UUID_REGEX.test(resolvedPropertyId)) {
        if (!args.property_title) return JSON.stringify({ error: "Necesito el título/dirección o ID de la propiedad." });
        const searchTitle = sanitizePattern(args.property_title);
        const pattern = `%${searchTitle}%`;
        const [byTitle, byAddress] = await Promise.all([
          supabase.from("properties").select("id, title, address").ilike("title", pattern).limit(5),
          supabase.from("properties").select("id, title, address").ilike("address", pattern).limit(5),
        ]);
        const seen = new Set<string>();
        const props: Array<{ id: string; title: string | null; address: string | null }> = [];
        for (const p of [...(byTitle.data ?? []), ...(byAddress.data ?? [])]) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          props.push(p);
          if (props.length >= 5) break;
        }
        if (props.length === 0) return JSON.stringify({ error: `No encontré una propiedad con "${args.property_title}".` });
        if (props.length > 1) return JSON.stringify({ error: `Encontré ${props.length} propiedades similares: ${props.map((p) => p.title || p.address).join(", ")}. ¿Cuál querés?`, properties: props });
        resolvedPropertyId = props[0].id;
      }
      const validStatuses = ["sugerida", "enviada", "visitada", "descartada"];
      const updates: Record<string, any> = {};
      if (args.status && validStatuses.includes(args.status)) updates.status = args.status;
      if (typeof args.notes === "string") updates.notes = args.notes.trim().slice(0, 2000);
      if (Object.keys(updates).length === 0) return JSON.stringify({ error: "No hay campos para actualizar" });
      const { data, error } = await supabase
        .from("client_properties")
        .update(updates)
        .eq("client_id", resolvedClientId)
        .eq("property_id", resolvedPropertyId)
        .eq("user_id", userId)
        .select("id, status, notes")
        .single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      // enviada/visitada = contacto saliente real → registramos last_contact_at (señal del
      // panel staleClients del dashboard). Scopeado por userId. Ver ticket 86aj1f0wj.
      if (updates.status === "enviada" || updates.status === "visitada") {
        await supabase.from("clients").update({ last_contact_at: new Date().toISOString() }).eq("id", resolvedClientId).eq("user_id", userId);
      }
      return JSON.stringify({ success: true, message: "Propiedad del cliente actualizada.", data });
    }

    // ---- Client Events ----
    case "create_client_event": {
      // Resolve client
      let resolvedClientId = args.client_id;
      if (!resolvedClientId && args.client_name) {
        const search = sanitizePattern(args.client_name);
        if (search) {
          const { data: found } = await supabase.from("clients").select("id, full_name").eq("user_id", userId).ilike("full_name", `%${search}%`).limit(1);
          if (found?.length) resolvedClientId = found[0].id;
          else return JSON.stringify({ error: `No se encontró un cliente con nombre "${args.client_name}"` });
        }
      }
      if (!resolvedClientId || !UUID_REGEX.test(resolvedClientId)) return JSON.stringify({ error: "Se requiere client_id o client_name" });
      
      const title = typeof args.title === "string" ? args.title.trim().slice(0, 300) : null;
      if (!title) return JSON.stringify({ error: "El título es requerido" });
      const eventDate = typeof args.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.event_date) ? args.event_date : null;
      if (!eventDate) return JSON.stringify({ error: "La fecha es requerida (formato YYYY-MM-DD)" });
      
      const validEventTypes: string[] = [...CLIENT_EVENT_TYPES];
      const eventType = validEventTypes.includes(args.event_type) ? args.event_type : "custom";
      const validRecurrences: string[] = [...CLIENT_EVENT_RECURRENCES];
      const recurrence = validRecurrences.includes(args.recurrence) ? args.recurrence : "yearly";
      const notes = typeof args.notes === "string" ? args.notes.trim().slice(0, 1000) : null;

      // Try to sync with Google Calendar
      let googleEventId: string | null = null;
      try {
        const accessToken = await getCalendarToken();
        if (accessToken) {
          // Calculate next occurrence for the calendar event (date-only, Córdoba)
          const nextDateISO = nextOccurrenceISO(eventDate, recurrence);

          const calendarBody: any = {
            summary: title,
            start: { date: nextDateISO },
            end: { date: nextDateISO },
            reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 1440 }] }, // 1 day before
          };
          if (notes) calendarBody.description = notes;
          if (recurrence !== "once") {
            const rruleFreq = recurrence === "yearly" ? "YEARLY" : "MONTHLY";
            calendarBody.recurrence = [`RRULE:FREQ=${rruleFreq}`];
          }
          
          const calRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(calendarBody),
          });
          if (calRes.ok) {
            const calEvent = await calRes.json();
            googleEventId = calEvent.id;
          } else {
            console.error("Calendar sync error for client event:", await calRes.text());
          }
        }
      } catch (e) {
        console.error("Calendar sync error:", e);
      }

      const { data, error } = await supabase
        .from("client_events")
        .insert({ client_id: resolvedClientId, user_id: userId, event_type: eventType, title, event_date: eventDate, recurrence, google_event_id: googleEventId, notes })
        .select("id, title, event_type, event_date, recurrence, google_event_id")
        .single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, event: data, synced_to_calendar: !!googleEventId, message: `Evento "${title}" creado${googleEventId ? " y sincronizado con Google Calendar 📅" : ""}.` });
    }

    case "list_client_events": {
      const daysAhead = Math.min(Math.max(safePositiveInt(args.days_ahead) ?? 90, 1), 365);
      let query = supabase
        .from("client_events")
        .select("id, client_id, event_type, title, event_date, recurrence, google_event_id, notes, clients(full_name)")
        .eq("user_id", userId)
        .order("event_date", { ascending: true });
      
      if (args.client_id && UUID_REGEX.test(args.client_id)) {
        query = query.eq("client_id", args.client_id);
      }

      const { data, error } = await query;
      if (error) return JSON.stringify({ error: safeDbError(error) });

      // Filter to upcoming events within daysAhead (considering recurrence).
      // Comparación por fecha (YYYY-MM-DD) en Córdoba para no perder eventos de hoy.
      const todayISO = todayCordobaISO();
      const cutoffISO = addDaysISO(todayISO, daysAhead);

      const upcoming = (data ?? []).map((ev: any) => {
        const next = nextOccurrenceISO(ev.event_date, ev.recurrence, todayISO);
        return { ...ev, client_name: ev.clients?.full_name, next_occurrence: next };
      }).filter((ev: any) => {
        return ev.next_occurrence >= todayISO && ev.next_occurrence <= cutoffISO;
      }).sort((a: any, b: any) => a.next_occurrence.localeCompare(b.next_occurrence));

      return JSON.stringify({ events: upcoming, total: upcoming.length });
    }

    case "delete_client_event": {
      if (!args.event_id || !UUID_REGEX.test(args.event_id)) return JSON.stringify({ error: "ID de evento inválido" });
      
      // Get the event to check for Google Calendar sync
      const { data: ev } = await supabase.from("client_events").select("google_event_id, title").eq("id", args.event_id).eq("user_id", userId).single();
      if (!ev) return JSON.stringify({ error: "Evento no encontrado" });

      // Delete from Google Calendar if synced
      if (ev.google_event_id) {
        try {
          const accessToken = await getCalendarToken();
          if (accessToken) {
            await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(ev.google_event_id)}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${accessToken}` },
            });
          }
        } catch (e) {
          console.error("Calendar delete error:", e);
        }
      }

      const { error } = await supabase.from("client_events").delete().eq("id", args.event_id).eq("user_id", userId);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, message: `Evento "${ev.title}" eliminado${ev.google_event_id ? " (también de Google Calendar)" : ""}.` });
    }

    // ---- Client Notes / Tasks ----
    case "create_client_note": {
      let clientId = args.client_id;
      // Resolve by name if no ID
      if (!clientId && args.client_name) {
        const search = sanitizePattern(args.client_name);
        if (search) {
          const { data: found } = await supabase.from("clients").select("id, full_name").eq("user_id", userId).ilike("full_name", `%${search}%`).limit(1);
          if (found?.length) clientId = found[0].id;
          else return JSON.stringify({ error: `No encontré un cliente con nombre "${args.client_name}"` });
        }
      }
      if (!clientId || !UUID_REGEX.test(clientId)) return JSON.stringify({ error: "Se necesita un client_id o client_name válido" });
      const content = typeof args.content === "string" ? args.content.trim().slice(0, 2000) : null;
      if (!content) return JSON.stringify({ error: "El contenido de la nota es requerido" });
      const isAction = args.is_action === true;
      const { data, error } = await supabase
        .from("client_notes")
        .insert({ client_id: clientId, user_id: userId, content, is_action: isAction, is_done: false })
        .select("id, content, is_action, is_done, created_at")
        .single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, note: data, message: isAction ? `Tarea pendiente creada: "${content}"` : `Nota guardada: "${content}"` });
    }

    case "list_client_notes": {
      if (!args.client_id || !UUID_REGEX.test(args.client_id)) return JSON.stringify({ error: "ID de cliente inválido" });
      let query = supabase
        .from("client_notes")
        .select("id, content, is_action, is_done, created_at")
        .eq("client_id", args.client_id)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!args.show_done) query = query.eq("is_done", false);
      const { data, error } = await query;
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ notes: data ?? [], total: data?.length ?? 0 });
    }

    case "toggle_client_note": {
      if (!args.note_id || !UUID_REGEX.test(args.note_id)) return JSON.stringify({ error: "ID de nota inválido" });
      const isDone = args.is_done === true;
      const { data, error } = await supabase
        .from("client_notes")
        .update({ is_done: isDone })
        .eq("id", args.note_id)
        .eq("user_id", userId)
        .select("id, content, is_done")
        .single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, note: data, message: isDone ? `Tarea completada ✅` : `Tarea marcada como pendiente` });
    }

    default:
      return JSON.stringify({ error: "Tool not found" });
  }
}
