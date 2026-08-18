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
  resolveContactTimestamp,
  todayCordobaISO,
  addDaysISO,
  wrapUntrustedWebContent,
  UNTRUSTED_WEB_NOTICE,
  rankProperties,
  neutralizeControlMarkers,
  sanitizeExternalPortalResult,
  normalizeOperation,
  stripChatMarkers,
  phoneDedupKey,
  nameDedupKey,
  prepareContactBatch,
  exactNameMatches,
  parseEmailList,
} from "./validators.ts";
import {
  extractMeetLink,
  buildCalendarEvent,
  parseEventDates,
  buildMimeEmail,
} from "./google.ts";
import { CLIENT_EVENT_TYPES, CLIENT_EVENT_RECURRENCES } from "../alan-facts.ts";
import { normalizePhone } from "../whatsapp-guardrail.ts";

/**
 * Registra un cliente (name + teléfono canónico) en el registro por-turno que usa el guardarraíl de
 * WhatsApp para corregir números inventados. Se llena en list_clients/get_client. Skip si el teléfono
 * no normaliza (no sirve para un botón de WhatsApp). Ver whatsapp-guardrail.ts / 86ajb5g8d.
 */
function registerContact(ctx: any, fullName: unknown, rawPhone: unknown): void {
  const phone = normalizePhone(typeof rawPhone === "string" ? rawPhone : null);
  const name = typeof fullName === "string" ? fullName.trim() : "";
  if (!phone || !name) return;
  if (!ctx.clientRegistry) ctx.clientRegistry = [];
  ctx.clientRegistry.push({ name, phone });
}

/**
 * Registra una propiedad en la lista ORDENADA de tarjetas del turno y devuelve un "stub" para el
 * modelo. El stub OCULTA los strings que el modelo fabrica (`url`, `photo`, `photos`): sin ellos no
 * puede escribir la tarjeta a mano ni el link → tiene que dejar que el server la arme. El server
 * matchea por POSICIÓN (orden de esta lista), no por ningún id que emita el modelo, así que no hay
 * nada que el modelo pueda transcribir mal. Ver card-render.ts e incidente 86ajangkb. La lista es
 * per-turno (vive en toolCtx, que se recrea por request).
 */
function toCardStub(ctx: any, property: any): any {
  if (!property) return property;
  if (!ctx.cardResults) ctx.cardResults = [];
  // Dedup por id dentro del lote: la misma propiedad no genera dos tarjetas (ej. pool con
  // filas repetidas o favoritos duplicados). Sin id no podemos dedupear → se agrega igual.
  // Con lote FUSIONADO (tools distintas en el turno, ver beginCardBatch/M9) se aplica un cap
  // de tamaño total para no volcar una respuesta interminable.
  const id = property.id ?? null;
  if (!id || !ctx.cardResults.some((p: any) => p?.id === id)) {
    if (!ctx.cardBatchMerged || ctx.cardResults.length < CARD_MERGE_CAP) ctx.cardResults.push(property);
  }
  const { url: _url, photo: _photo, photos: _photos, ...rest } = property;
  return rest;
}

/** Cap del lote cuando se fusionan tarjetas de tools distintas en el mismo turno (M9). */
const CARD_MERGE_CAP = 30;

/**
 * Valida que el cliente exista y pertenezca al user. Las edge functions usan service_role
 * (bypass RLS): sin este check, un client_id UUID ajeno colgaría filas (eventos/notas) del
 * cliente de OTRO agente. Devuelve la fila o null (ticket 86aj9w5ke; patrón de
 * save_property_to_client).
 */
async function assertClientOwned(supabase: any, userId: string, clientId: string): Promise<{ id: string; full_name: string | null } | null> {
  const { data } = await supabase.from("clients").select("id, full_name").eq("id", clientId).eq("user_id", userId).maybeSingle();
  return data ?? null;
}

/**
 * Arranca un LOTE de tarjetas para `toolName`. Semántica (M9):
 *  - MISMA tool que el lote existente (búsquedas sucesivas) → REEMPLAZA ("última búsqueda gana"):
 *    dos search_properties en el mismo turno no deben volcar las tarjetas de ambas.
 *  - TOOL DISTINTA con resultados en ambos lados ("favoritos de Juan + buscá similares") →
 *    CONCATENA con dedup por id (cap CARD_MERGE_CAP): el texto describe ambas listas y "última
 *    gana" suprimía las tarjetas de la primera.
 * Se vacía EN EL LUGAR (length = 0) porque index.ts conserva la referencia al array.
 * Solo se llama cuando la tool tiene resultados; el camino de 0 resultados usa clearCardBatch (M6).
 */
function beginCardBatch(ctx: any, toolName: string): void {
  if (!ctx.cardResults) ctx.cardResults = [];
  const merge = !!ctx.cardBatchTool && ctx.cardBatchTool !== toolName && ctx.cardResults.length > 0;
  if (!merge) ctx.cardResults.length = 0;
  ctx.cardBatchMerged = merge;
  ctx.cardBatchTool = toolName;
  // Señal para la red de seguridad de leftovers en index.ts (M7): el lote quedó fresco (la tool
  // que lo produjo devolvió resultados). clearCardBatch la apaga.
  ctx.cardBatchFresh = true;
}

/**
 * Limpia el lote de tarjetas del turno (M6): una búsqueda con 0 resultados NO debe dejar pegado el
 * lote de una tool anterior — el expansor anexaría tarjetas viejas debajo de un "no encontré".
 */
function clearCardBatch(ctx: any): void {
  if (!ctx.cardResults) ctx.cardResults = [];
  ctx.cardResults.length = 0;
  ctx.cardBatchTool = null;
  ctx.cardBatchMerged = false;
  ctx.cardBatchFresh = false;
}

/**
 * Baja la agenda COMPLETA (id, full_name, phone, is_client) del agente con paginación .range():
 * PostgREST corta silenciosamente en ~1000 filas, así que un select "sin límite" NO es toda la
 * agenda — con 1500 contactos, la validación de teléfonos y el dedup ignoraban 500. El matching por
 * .in("phone", …) exacto se descartó por frágil (los teléfonos en DB vienen en formatos heterogéneos
 * y la clave de comparación es normalizada), así que se pagina y se normaliza en memoria.
 * La consumen: el guardarraíl de WhatsApp (index.ts, necesita phone+full_name), el dedup de
 * create_client y el de create_clients_bulk. SIEMPRE scopeada por user_id.
 */
export async function fetchAllClientContactRows(
  supabase: any,
  userId: string,
): Promise<{ rows: Array<{ id: string; full_name: string | null; phone: string | null; is_client: boolean | null }>; error: any }> {
  const PAGE = 1000;
  const MAX_PAGES = 50; // tope de sanidad: 50k filas
  const rows: Array<{ id: string; full_name: string | null; phone: string | null; is_client: boolean | null }> = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await supabase
      .from("clients")
      .select("id, full_name, phone, is_client")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(p * PAGE, (p + 1) * PAGE - 1);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return { rows, error: null };
}

export async function executeTool(
  name: string,
  args: any,
  ctx: {
    supabase: any;
    userId: string;
    conversationId: string;
    getCalendarToken: () => Promise<string | null>;
    // Lista ordenada de propiedades a mostrar como tarjeta en este turno. La llena toCardStub y la
    // consume el expansor de <<<PROPERTIES>>> en index.ts (sanitizeFinal), por posición. Opcional
    // para no romper callers/tests.
    cardResults?: any[];
    // Registro por-turno de contactos (name + teléfono canónico) para el guardarraíl de WhatsApp.
    clientRegistry?: Array<{ name: string; phone: string }>;
    // Última página de list_clients del turno → tarjetas de contacto (<<<CONTACTS>>>, ver card-render.ts).
    contactCardResults?: any[];
    // Batch(es) de list_clients(mark_contacted) del turno: valor previo de last_contact_at +
    // teléfono canónico por cliente, y filas del activity log con su client_id, para que
    // sanitizeFinal (index.ts) pueda REVERTIR POR DIFERENCIA a los clientes sin borrador válido
    // (M3). Si la tool corre 2+ veces en el turno, los batches se ACUMULAN (no se pisan).
    markedBatch?: {
      rows: Array<{ id: string; prev: string | null; phone: string | null }>;
      logs: Array<{ id: string; client_id: string }>;
    } | null;
    // Eco de la ÚLTIMA search_properties del turno (applied_filters): lo consume el supervisor
    // para la regla determinista de claims sin respaldo ("activas/perfectamente/100%").
    lastSearchAppliedFilters?: Record<string, unknown> | null;
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
      let currency = sanitizePattern(args.currency);
      const office = stripAccents(sanitizePattern(args.office));
      const excludeOffice = stripAccents(sanitizePattern(args.exclude_office));
      // min_price=0 significa "sin mínimo" (Gemini lo manda así): se trata como NO seteado — un 0
      // no filtra nada pero disparaba el default de moneda USD y rompía alquileres en ARS (M8).
      const minPriceRaw = safePositiveNumber(args.min_price);
      const min_price = minPriceRaw === 0 ? null : minPriceRaw;
      const max_price = safePositiveNumber(args.max_price);
      const min_ambientes = safePositiveInt(args.min_ambientes);
      const max_ambientes = safePositiveInt(args.max_ambientes);
      const min_habitaciones = safePositiveInt(args.min_habitaciones);
      const max_habitaciones = safePositiveInt(args.max_habitaciones);
      const limit = Math.min(Math.max(safePositiveInt(args.limit) ?? 5, 1), 50);
      // Paginación ("mostrame más"): el pool se trae SIEMPRE desde 0 (rango [0, offset+pool)) y el
      // offset se aplica DESPUÉS del re-rankeo Docta-first (B1). Si el offset desplazara el pool,
      // el re-orden en memoria haría que cada página re-rankee un pool distinto → propiedades
      // repetidas y salteadas entre páginas.
      const offset = Math.max(0, safePositiveInt(args.offset) ?? 0);
      // only_active (default true): el scraper escribe listing_status='active'; filas legacy
      // pueden tener NULL y cuentan como activas. Tolerante al quirk Gemini de booleans string.
      const onlyActive = !(args.only_active === false || args.only_active === "false");
      // docta_first (default true, regla canónica de prioridad Docta): false SOLO cuando el
      // agente pide explícitamente las de otras oficinas (típicamente con exclude_office).
      const doctaFirst = !(args.docta_first === false || args.docta_first === "false");
      // Moneda default USD cuando hay filtro de precio sin moneda explícita (el mercado de VENTA
      // opera en USD): sin esto un max_price=120000 mezclaba precios en ARS. NO aplica cuando la
      // operación es Alquiler / Alquiler temporario (ese mercado opera en pesos: forzar USD
      // vaciaba los resultados — M8). Cuando aplica, se ecoa currency_defaulted en applied_filters.
      const canonicalOperation = normalizeOperation(operation);
      let currencyDefaulted = false;
      if ((min_price !== null || max_price !== null) && !currency &&
          canonicalOperation !== "Alquiler" && canonicalOperation !== "Alquiler temporario") {
        currency = "USD";
        currencyDefaulted = true;
      }
      // POOL ampliado (limit*10, cap 300) ordenado por created_at DESC para re-rankear
      // Docta-first EN MEMORIA antes de truncar (ver rankProperties: se decidió pool grande +
      // rank en memoria en vez de ORDER BY por expresión, que PostgREST no soporta sin columna
      // computada). Ver ticket 86aj1f0ve.
      const poolLimit = Math.min(limit * 10, 300);

      // Criterios MÚLTIPLES (separados por coma) y EXCLUSIONES (86ajbjq22): un cliente puede tener
      // preferred_zones="Córdoba, Sierras" o property_type_interest="Casa, Departamento", y pedir
      // "en todos lados MENOS Nueva Córdoba y Centro". orSafe deja solo letras/números/espacios/guión
      // (sin comas/paréntesis/puntos) para que el string de .or() no se pueda inyectar. Solo se activa
      // el camino multi cuando hay >1 valor: las búsquedas de un solo valor quedan idénticas.
      const orSafe = (s: string): string => s.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
      const parseList = (raw: unknown): string[] =>
        typeof raw === "string" && raw.trim()
          ? raw.split(",").map((v) => stripAccents(orSafe(v)) || "").filter(Boolean)
          : [];
      const zones = parseList(args.zone);
      const propertyTypes = parseList(args.property_type);
      const excludeZones = parseList(args.exclude_zones);
      const excludeNeighborhoods = parseList(args.exclude_neighborhoods);

      const applyFilters = (q: any, opts?: { skipLocality?: boolean; useLocalityAsTitle?: boolean; skipZone?: boolean; skipMaxPrice?: boolean; skipMinRooms?: boolean; skipPrice?: boolean }) => {
        // only_active: publicación activa = listing_status 'active' O NULL (filas legacy
        // anteriores a la columna). Aplica a count y data por igual.
        if (onlyActive) q = q.or("listing_status.eq.active,listing_status.is.null");
        if (!opts?.skipZone) {
          if (zones.length > 1) q = q.or(zones.map((z) => `zone.ilike.%${z}%`).join(","));
          else if (zone) q = q.ilike("zone", `%${zone}%`);
        }
        for (const z of excludeZones) q = q.not("zone", "ilike", `%${z}%`);
        for (const n of excludeNeighborhoods) q = q.not("zone_neighborhood", "ilike", `%${n}%`);
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
        if (propertyTypes.length > 1) q = q.or(propertyTypes.map((t) => `property_type.ilike.%${t}%`).join(","));
        else if (property_type) q = q.ilike("property_type", `%${property_type}%`);
        if (min_price !== null && !opts?.skipPrice) q = q.gte("price", min_price);
        if (max_price !== null && !opts?.skipMaxPrice && !opts?.skipPrice) q = q.lte("price", max_price);
        if (currency && !opts?.skipPrice) q = q.ilike("currency", `%${currency}%`);
        if (min_ambientes !== null && !opts?.skipMinRooms) q = q.gte("ambientes", min_ambientes);
        if (max_ambientes !== null) q = q.lte("ambientes", max_ambientes);
        if (min_habitaciones !== null && !opts?.skipMinRooms) q = q.gte("habitaciones", min_habitaciones);
        if (max_habitaciones !== null) q = q.lte("habitaciones", max_habitaciones);
        if (office) q = q.ilike("office", `%${office}%`);
        if (excludeOffice) {
          // m1: NOT ILIKE solo descarta filas con office NO nulo — office IS NULL también debe
          // pasar el filtro ("que no sea de Docta" incluye las sin oficina cargada). Se sanea el
          // término con el mismo criterio que orSafe para que el string de .or() no sea inyectable.
          const exOr = excludeOffice.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
          if (exOr) q = q.or(`office.is.null,office.not.ilike.%${exOr}%`);
        }
        return q;
      };

      // ECO DE FILTROS (honestidad de la búsqueda): applied_filters = lo que REALMENTE se aplicó
      // (valores post-sanitización); ignored_filters = args que llegaron pero NO se aplicaron
      // (no soportados o descartados por sanitización). Regla de prompt/supervisor: Alan solo
      // puede afirmar criterios presentes en applied_filters.
      const applied_filters: Record<string, unknown> = {};
      if (zones.length > 1) applied_filters.zone = zones.join(", ");
      else if (zone) applied_filters.zone = zone;
      if (locality) applied_filters.locality = locality;
      if (neighborhood) applied_filters.neighborhood = neighborhood;
      if (city) applied_filters.city = city;
      if (titleSearch) applied_filters.title = titleSearch;
      if (operation) applied_filters.operation = canonicalOperation ?? operation;
      if (propertyTypes.length > 1) applied_filters.property_type = propertyTypes.join(", ");
      else if (property_type) applied_filters.property_type = property_type;
      if (excludeZones.length) applied_filters.exclude_zones = excludeZones.join(", ");
      if (excludeNeighborhoods.length) applied_filters.exclude_neighborhoods = excludeNeighborhoods.join(", ");
      if (min_price !== null) applied_filters.min_price = min_price;
      if (max_price !== null) applied_filters.max_price = max_price;
      if (currency) applied_filters.currency = currency;
      if (currencyDefaulted) applied_filters.currency_defaulted = true;
      if (min_ambientes !== null) applied_filters.min_ambientes = min_ambientes;
      if (max_ambientes !== null) applied_filters.max_ambientes = max_ambientes;
      if (min_habitaciones !== null) applied_filters.min_habitaciones = min_habitaciones;
      if (max_habitaciones !== null) applied_filters.max_habitaciones = max_habitaciones;
      if (office) applied_filters.office = office;
      if (excludeOffice) applied_filters.exclude_office = excludeOffice;
      applied_filters.only_active = onlyActive;
      applied_filters.docta_first = doctaFirst;
      if (offset > 0) applied_filters.offset = offset;
      applied_filters.limit = limit;

      const SUPPORTED_ARGS = new Set([
        "locality", "zone", "neighborhood", "city", "title", "operation", "property_type",
        "exclude_zones", "exclude_neighborhoods", "min_price", "max_price", "currency",
        "min_ambientes", "max_ambientes", "min_habitaciones", "max_habitaciones",
        "office", "exclude_office", "docta_first", "only_active", "offset", "limit",
      ]);
      const ALWAYS_APPLIED = new Set(["only_active", "docta_first", "offset", "limit"]);
      const ignored_filters: string[] = [];
      for (const k of Object.keys(args ?? {})) {
        const provided = (args as any)[k];
        if (provided === null || provided === undefined || provided === "") continue;
        if (!SUPPORTED_ARGS.has(k)) { ignored_filters.push(k); continue; }
        if (!(k in applied_filters) && !ALWAYS_APPLIED.has(k)) ignored_filters.push(k);
      }
      // Eco para el supervisor (regla determinista de claims sin respaldo). Per-turno en toolCtx;
      // la última búsqueda del turno gana (consistente con el lote de tarjetas).
      ctx.lastSearchAppliedFilters = applied_filters;

      // Validación min>max DESPUÉS de setear el eco (m2): así el supervisor ve los filtros del
      // intento aunque la búsqueda no llegue a correr.
      if (min_price !== null && max_price !== null && min_price > max_price) {
        return JSON.stringify({ error: `Rango de precio inválido: min_price (${min_price}) es mayor que max_price (${max_price}). Corregí el rango y volvé a buscar.` });
      }

      // Primary search. La query de datos trae un pool ordenado; la de count queda intacta
      // (head:true → total_count real del universo, sin order ni pool).
      let baseQuery = applyFilters(supabase.from("properties").select("*", { count: "exact", head: true }));
      let dataQuery = applyFilters(supabase.from("properties").select("*")).order("created_at", { ascending: false }).range(0, offset + poolLimit - 1);

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
        ).order("created_at", { ascending: false }).range(0, offset + poolLimit - 1);
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
        ).order("created_at", { ascending: false }).range(0, offset + poolLimit - 1);
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
        ).ilike("title", `%${zone}%`).order("created_at", { ascending: false }).range(0, offset + poolLimit - 1);
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
        // M6: 0 resultados limpia el lote de tarjetas del turno — sin esto, el expansor anexaba
        // las tarjetas de una tool ANTERIOR debajo de un "no encontré".
        clearCardBatch(ctx);
        // M5: con offset > 0 y universo real > 0 no es "sin resultados": es el FIN de la
        // paginación. Sin mensaje de sin-resultados ni relax_hints (serían falsos).
        if (offset > 0 && totalCount > 0) {
          return JSON.stringify({
            end_of_results: true,
            total_count: totalCount,
            showing: 0,
            applied_filters,
            ...(ignored_filters.length ? { ignored_filters } : {}),
            message: "No hay más resultados: ya se mostraron todas las propiedades de esta búsqueda.",
          });
        }
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
        // price_unset_count también en el camino de 0 resultados: un rango de precio puede haber
        // dejado afuera SOLO las "a consultar" — dato clave para que Alan ofrezca algo.
        let price_unset_count0 = 0;
        if (min_price !== null || max_price !== null) {
          const { count: unsetCount } = await applyFilters(
            supabase.from("properties").select("*", { count: "exact", head: true }),
            { skipPrice: true },
          ).is("price", null);
          price_unset_count0 = unsetCount ?? 0;
        }
        // M8: si la moneda se defaulteó a USD, un presupuesto en pesos pudo vaciar la búsqueda —
        // sugerimos revisar la moneda en el mensaje.
        const noResultsMsg = currencyDefaulted
          ? "No se encontraron propiedades con esos criterios. Ojo: el filtro de precio asumió USD por default — si el presupuesto era en pesos, repetí la búsqueda con currency=\"ARS\"."
          : "No se encontraron propiedades con esos criterios.";
        return JSON.stringify({
          message: noResultsMsg,
          total_count: 0,
          results: [],
          applied_filters,
          ...(ignored_filters.length ? { ignored_filters } : {}),
          ...(price_unset_count0 > 0 ? { price_unset_count: price_unset_count0 } : {}),
          ...(relax_hints.length ? { relax_hints } : {}),
        });
      }

      // price_unset_count: propiedades que cumplen el RESTO de los filtros pero tienen precio
      // NULL ("a consultar") — el gte/lte las excluye de total_count. Solo se calcula con filtro
      // de precio activo (sin filtro de precio ya integran total_count). Se computa sobre los
      // filtros base (sin los fallbacks por título: caso borde, se prefiere simple y honesto).
      let price_unset_count = 0;
      if ((min_price !== null || max_price !== null) && !titleFallbackTerm) {
        const { count: unsetCount } = await applyFilters(
          supabase.from("properties").select("*", { count: "exact", head: true }),
          { skipPrice: true },
        ).is("price", null);
        price_unset_count = unsetCount ?? 0;
      }

      // Re-rankeamos el pool COMPLETO Docta-first (salvo docta_first=false) y recién ahí aplicamos
      // la paginación: primero se ordena el universo [0, offset+limit) y después se corta la página
      // con .slice(offset) (B1 — el rankeo estable garantiza páginas consecutivas sin solapamiento
      // ni salteos). total_count sigue siendo el universo real (count head:true).
      const ranked = rankProperties(data, offset + limit, doctaFirst).slice(offset);
      if (ranked.length === 0) {
        // M5: offset más allá del final del pool — fin de la paginación, no "sin resultados".
        clearCardBatch(ctx);
        return JSON.stringify({
          end_of_results: true,
          total_count: totalCount,
          showing: 0,
          applied_filters,
          ...(ignored_filters.length ? { ignored_filters } : {}),
          message: "No hay más resultados: ya se mostraron todas las propiedades de esta búsqueda.",
        });
      }
      const doctaCount = ranked.filter((p: any) => p.office?.toLowerCase().includes("docta")).length;
      // Lote de tarjetas del turno: búsquedas sucesivas REEMPLAZAN ("última búsqueda gana"); si el
      // lote venía de OTRA tool con resultados, se fusiona con dedup — ver beginCardBatch (M9).
      beginCardBatch(ctx, "search_properties");
      // Cada resultado se registra y se devuelve como stub con `ref` (sin url/photo): el modelo
      // muestra la propiedad emitiendo <<<CARD:ref>>>, no escribiendo la tarjeta. Ver toCardStub / 86ajangkb.
      const results = ranked.map((p: any) => toCardStub(ctx, p));

      return JSON.stringify({
        total_count: totalCount,
        showing: results.length,
        docta_in_results: doctaCount,
        applied_filters,
        ...(ignored_filters.length ? { ignored_filters } : {}),
        ...(price_unset_count > 0 ? { price_unset_count, price_unset_note: "Propiedades que cumplen el resto de los filtros pero con precio 'a consultar' (sin precio cargado): el filtro de precio no las puede evaluar. Ofrecéselas al agente como opción aparte." } : {}),
        results,
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
      // Lote de tarjetas (replace misma tool / merge entre tools distintas, ver beginCardBatch/M9)
      // + stub sin url/photo (ver toCardStub / 86ajangkb).
      if ((data ?? []).length > 0) beginCardBatch(ctx, "get_favorites");
      const favorites = (data ?? []).map((f: any) => (f.properties ? { ...f, properties: toCardStub(ctx, f.properties) } : f));
      return JSON.stringify({ favorites });
    }

    case "add_favorite": {
      if (!args.property_id || !UUID_REGEX.test(args.property_id)) {
        return JSON.stringify({ error: "ID de propiedad inválido" });
      }
      // Mismo hueco que save_property_to_client (86ak29y3q): el id puede estar stale
      // si el scraper borró la propiedad → validar existencia antes de escribir (FK 23503).
      const { data: favProp } = await supabase.from("properties").select("id").eq("id", args.property_id).maybeSingle();
      if (!favProp) return JSON.stringify({ error: "Esa propiedad ya no está publicada (se dio de baja del listado). Volvé a buscarla con search_properties." });
      // Re-favoritear es idempotente (86ajjn29n): avisamos si ya estaba, y el upsert
      // sobre la unique (user_id,property_id) cubre la carrera del doble insert (23505).
      const { data: existingFav } = await supabase.from("favorites").select("property_id").eq("user_id", userId).eq("property_id", args.property_id).maybeSingle();
      if (existingFav) return JSON.stringify({ success: true, message: "Esa propiedad ya estaba en favoritos." });
      const { error } = await supabase.from("favorites").upsert({ user_id: userId, property_id: args.property_id }, { onConflict: "user_id,property_id" });
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
      const is_client = args.is_client === false || args.is_client === "false" ? false : true; // tolerante a "false" string (quirk Gemini)
      const birthday = typeof args.birthday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.birthday) ? args.birthday : null;
      const company = typeof args.company === "string" ? args.company.trim().slice(0, 100) : null;
      const address = typeof args.address === "string" ? args.address.trim().slice(0, 200) : null;
      const preferred_zones = typeof args.preferred_zones === "string" ? args.preferred_zones.trim().slice(0, 300) : null;
      const budget_min = safePositiveNumber(args.budget_min);
      const budget_max = safePositiveNumber(args.budget_max);
      const budget_currency = VALID_BUDGET_CURRENCIES.includes(args.budget_currency) ? args.budget_currency : "USD";
      const property_type_interest = typeof args.property_type_interest === "string" ? args.property_type_interest.trim().slice(0, 200) : null;
      const source = typeof args.source === "string" ? args.source.trim().slice(0, 100) : null;
      // Guard anti-duplicado (86ajbr466): si ya existe alguien con el MISMO teléfono, no creamos otra
      // fila (las agendas de los agentes venían llenándose de copias — hasta 10 por persona — y eso
      // rompía la rotación de campañas). Devolvemos el existente para que Alan lo diga con claridad.
      const newPk = phoneDedupKey(phone);
      let dedupWarning: string | null = null;
      if (newPk) {
        // Agenda completa PAGINADA (cap ~1000 de PostgREST): sin esto, el dedup no veía las filas
        // más allá de la primera página y se colaban duplicados en agendas grandes.
        const { rows: dupRows, error: dupErr } = await fetchAllClientContactRows(supabase, userId);
        if (dupErr) {
          // m11: FAIL-OPEN — un error transitorio del chequeo de duplicados no debe bloquear el
          // alta (el comportamiento histórico era crear directo). Se crea igual, con warning.
          console.error("create_client dedup check error (fail-open):", dupErr);
          dedupWarning = "No pude verificar duplicados por un error transitorio: lo creé igual. Si sospechás que ya existía, revisá la agenda.";
        } else {
          const dup = dupRows.find((r) => phoneDedupKey(r.phone) === newPk);
          if (dup) {
            return JSON.stringify({
              success: false,
              duplicate: true,
              existing: { id: dup.id, full_name: dup.full_name },
              message: `Ya existe "${dup.full_name}" con ese teléfono en la agenda. No lo dupliqué; si querés actualizar sus datos usá update_client.`,
            });
          }
        }
      }
      const { data, error } = await supabase
        .from("clients")
        .insert({ user_id: userId, full_name, phone, email, notes, status, client_type, birthday, company, address, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, source, is_client })
        .select("id, full_name, status, client_type, is_client")
        .single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({
        success: true,
        client: data,
        message: `${is_client ? "Cliente" : "Contacto"} "${full_name}" creado correctamente.${dedupWarning ? ` ${dedupWarning}` : ""}`,
        ...(dedupWarning ? { warning: dedupWarning } : {}),
      });
    }

    case "create_clients_bulk": {
      // Carga MASIVA de contactos/clientes en UNA sola llamada (86ajbr466). Antes cada contacto era
      // un create_client individual: con listas grandes el tool-loop se quedaba corto (cap de
      // iteraciones), el modelo "narraba" llamadas sin ejecutarlas y CONFIRMABA cargas que nunca
      // pasaron (caso Carla: ~260 pegados, 138 reales, "412" reportados). Acá: un insert batch,
      // dedup contra la agenda y dentro del lote, y CONTEOS REALES que Alan debe reportar tal cual.
      const contacts = Array.isArray(args.contacts) ? args.contacts.slice(0, 300) : [];
      if (contacts.length === 0) return JSON.stringify({ error: "La lista de contactos está vacía. Pasá un array en 'contacts'." });
      // Tolerante al quirk de Gemini de mandar booleans como string ("false").
      const isClient = args.is_client === false || args.is_client === "false" ? false : true;

      // Agenda existente → sets de dedup (teléfono; nombre solo para filas sin teléfono).
      // PAGINADA (cap ~1000 de PostgREST): en agendas grandes el dedup ignoraba todo lo que
      // quedaba fuera de la primera página.
      const { rows: existing, error: exErr } = await fetchAllClientContactRows(supabase, userId);
      if (exErr) return JSON.stringify({ error: safeDbError(exErr) });
      const existingPhones = new Set<string>();
      const existingNames = new Set<string>();
      for (const r of existing) {
        const pk = phoneDedupKey(r.phone);
        if (pk) existingPhones.add(pk);
        const nk = nameDedupKey(r.full_name);
        if (nk) existingNames.add(nk);
      }

      const { rows, skipped_duplicates, invalid } = prepareContactBatch(contacts, existingPhones, existingNames, isClient);

      let created = 0;
      if (rows.length > 0) {
        const { data: inserted, error } = await supabase
          .from("clients")
          .insert(rows.map((r) => ({ ...r, user_id: userId })))
          .select("id");
        if (error) return JSON.stringify({ error: safeDbError(error) });
        created = inserted?.length ?? 0;
      }
      // Total REAL post-inserción, para que Alan reporte el estado verdadero de la agenda.
      const { count: totalAfter } = await supabase
        .from("clients")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_client", isClient);

      return JSON.stringify({
        success: true,
        created,
        created_names: rows.map((r) => r.full_name),
        skipped_duplicates: skipped_duplicates.length,
        skipped_names: skipped_duplicates.map((s) => `${s.full_name} (${s.reason})`),
        invalid: invalid.length,
        total_in_agenda: totalAfter ?? null,
        kind: isClient ? "client" : "contact",
        instruction: `REPORTÁ EXACTAMENTE estos números al agente: ${created} creados, ${skipped_duplicates.length} salteados por duplicado, ${invalid.length} inválidos. Total real en agenda (${isClient ? "clientes" : "contactos"}): ${totalAfter ?? "?"}. NO digas "ya están todos" ni otro número.`,
      });
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
      if (typeof args.is_client === "boolean" || args.is_client === "true" || args.is_client === "false") updates.is_client = args.is_client === true || args.is_client === "true";
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
        .select("id, full_name, status, client_type, is_client")
        .single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      // Mensaje que refleja un movimiento de categoría cuando lo hubo (cliente↔contacto).
      const moveMsg = (typeof args.is_client === "boolean" || args.is_client === "true" || args.is_client === "false")
        ? ((args.is_client === true || args.is_client === "true") ? ` Lo moví a Clientes.` : ` Lo moví a Contactos.`)
        : "";
      return JSON.stringify({ success: true, client: data, message: `Cliente actualizado correctamente.${moveMsg}` });
    }

    case "list_clients": {
      const search = sanitizePattern(args.search);
      const status = VALID_CLIENT_STATUSES.includes(args.status) ? args.status : null;
      // kind: 'client' (default, is_client=true) | 'contact' (is_client=false) | 'all' (sin filtro).
      const kind = ["client", "contact", "all"].includes(args.kind) ? args.kind : "client";
      // client_type: buyer|seller|both. Un 'both' es comprador Y vendedor: "vendedores" = seller+both,
      // "compradores" = buyer+both. Sin esto Alan no podía pedir "dame vendedores" (86ajb5g6g).
      const clientTypeArg = VALID_CLIENT_TYPES.includes(args.client_type) ? args.client_type : null;
      // order: 'recent' (updated_at desc, default) | 'least_contacted' (last_contact_at asc, NULLs
      // —nunca contactados— primero). Base de las campañas de recontacto sin repetir.
      const order = args.order === "least_contacted" ? "least_contacted" : "recent";
      const limit = Math.min(Math.max(safePositiveInt(args.limit) ?? 20, 1), 100);
      const offset = Math.max(0, safePositiveInt(args.offset) ?? 0);
      // Tolerante al quirk de Gemini de mandar booleans como string ("true").
      const markContacted = args.mark_contacted === true || args.mark_contacted === "true";

      // Mismos filtros para la página de datos y para el COUNT real del universo (86ajbr466: el
      // tool devolvía total = largo de la página y Alan concluía "tenés 19 vendedores fríos"
      // cuando había 1124).
      const applyClientFilters = (q: any) => {
        q = q.eq("user_id", userId);
        if (kind === "client") q = q.eq("is_client", true);
        else if (kind === "contact") q = q.eq("is_client", false);
        if (clientTypeArg === "buyer") q = q.in("client_type", ["buyer", "both"]);
        else if (clientTypeArg === "seller") q = q.in("client_type", ["seller", "both"]);
        else if (clientTypeArg === "both") q = q.eq("client_type", "both");
        if (search) q = q.ilike("full_name", `%${search}%`);
        if (status) q = q.eq("status", status);
        return q;
      };
      let query = applyClientFilters(supabase
        .from("clients")
        .select("id, full_name, phone, email, status, client_type, is_client, notes, birthday, company, address, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, source, last_contact_at, created_at, updated_at"));
      if (order === "least_contacted") query = query.order("last_contact_at", { ascending: true, nullsFirst: true });
      else query = query.order("updated_at", { ascending: false });
      query = query.range(offset, offset + limit - 1);

      const [{ data, error }, { count: totalCount }] = await Promise.all([
        query,
        applyClientFilters(supabase.from("clients").select("*", { count: "exact", head: true })),
      ]);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      const clients = data ?? [];
      // Tarjetas de contacto (<<<CONTACTS>>>): la ÚLTIMA página listada del turno es la que se
      // muestra (replace, no append — si el modelo consulta el total y después pide la tanda,
      // gana la tanda). Ver card-render.ts / 86ajbr466.
      ctx.contactCardResults = clients;
      // Registro por-turno para el guardarraíl de WhatsApp (corrección de números inventados).
      for (const c of clients as any[]) registerContact(ctx, c.full_name, c.phone);

      // Marcado de campaña (opt-in): estampar last_contact_at=now() en el batch devuelto. Así el mismo
      // pedido con order=least_contacted devuelve gente DISTINTA la próxima vez → rotación sin repetir,
      // sin que el modelo tenga que "recordar" a quién dio (86ajb5g6g). Scopeado por user_id.
      let marked_contacted = 0;
      if (markContacted && clients.length > 0) {
        const ids = clients.map((c: any) => c.id);
        const { error: mErr } = await supabase
          .from("clients")
          .update({ last_contact_at: new Date().toISOString() })
          .in("id", ids)
          .eq("user_id", userId);
        if (!mErr) {
          marked_contacted = ids.length;
          // Auditoría: mismo registro que mark_client_contacted (historial visible en la ficha).
          // Best-effort; guardamos id + client_id para poder borrar SOLO las filas de los clientes
          // que se reviertan (M3: reversión por diferencia).
          const { data: logRows } = await supabase
            .from("client_activity_log")
            .insert(ids.map((id: string) => ({ client_id: id, user_id: userId, action_type: "call_logged", description: "Tanda de campaña marcada por Alan (list_clients mark_contacted)" })))
            .select("id, client_id");
          // REVERSIBILIDAD del batch (M3): `clients` se seleccionó ANTES del update, así que
          // c.last_contact_at es el valor previo; el teléfono canónico permite matchear contra los
          // bloques <<<WHATSAPP_TO>>> sobrevivientes del texto final. sanitizeFinal (index.ts)
          // revierte POR DIFERENCIA a los clientes sin borrador válido. Si la tool corre 2+ veces
          // en el turno, los batches se ACUMULAN (dedup por id conservando el prev ORIGINAL: el
          // segundo estampado pisó al primero y su "prev" ya sería el timestamp del primero).
          const newRows = clients.map((c: any) => ({ id: c.id, prev: c.last_contact_at ?? null, phone: normalizePhone(c.phone) }));
          const newLogs = ((logRows ?? []) as Array<{ id: string; client_id: string }>).map((r) => ({ id: r.id, client_id: r.client_id }));
          if (ctx.markedBatch?.rows?.length) {
            for (const r of newRows) {
              if (!ctx.markedBatch.rows.some((x: { id: string }) => x.id === r.id)) ctx.markedBatch.rows.push(r);
            }
            ctx.markedBatch.logs.push(...newLogs);
          } else {
            ctx.markedBatch = { rows: newRows, logs: newLogs };
          }
        }
      }

      return JSON.stringify({
        clients,
        showing: clients.length,
        total_count: totalCount ?? clients.length,
        kind,
        order,
        offset,
        ...(clientTypeArg ? { client_type: clientTypeArg } : {}),
        // m10: los IDs marcados NO van al payload que ve el modelo (son datos opacos que podría
        // transcribir mal); la reversión usa ctx.markedBatch, que nunca pasa por el modelo.
        ...(markContacted ? { marked_contacted } : {}),
      });
    }

    case "mark_client_contacted": {
      // Registro PROACTIVO de contactos hechos FUERA de la app ("ayer hablé con Julieta"):
      // estampa last_contact_at con la fecha REAL del contacto, para que la rotación de campañas
      // (order=least_contacted) y el widget "Último contacto" de la ficha reflejen la verdad.
      // Regla anti-retroceso: nunca pisa un last_contact_at MÁS RECIENTE que la fecha informada
      // (contar un contacto viejo no "des-contacta" a alguien ya contactado después).
      const when = resolveContactTimestamp(args.days_ago, args.date);
      if (!when) return JSON.stringify({ error: "Fecha inválida. Usá days_ago (0=hoy, 1=ayer) o date en formato YYYY-MM-DD, nunca futura." });

      // Nombres y/o IDs; tolerante a un string suelto en vez de array (quirk de Gemini).
      const rawNames: unknown[] = Array.isArray(args.client_names) ? args.client_names : typeof args.client_names === "string" && args.client_names.trim() ? [args.client_names] : [];
      const rawIds: unknown[] = Array.isArray(args.client_ids) ? args.client_ids : typeof args.client_ids === "string" && args.client_ids.trim() ? [args.client_ids] : [];
      if (rawNames.length === 0 && rawIds.length === 0) return JSON.stringify({ error: "Necesito al menos un client_name o client_id de a quién contactaste." });

      type Target = { id: string; full_name: string; last_contact_at: string | null };
      const targets: Target[] = [];
      const not_found: string[] = [];
      const ambiguous: Array<{ name: string; matches: string[] }> = [];

      for (const rawId of rawIds.slice(0, 50)) {
        if (typeof rawId !== "string" || !UUID_REGEX.test(rawId)) continue;
        const { data } = await supabase.from("clients").select("id, full_name, last_contact_at").eq("id", rawId).eq("user_id", userId).maybeSingle();
        if (data) targets.push(data as Target);
        else not_found.push(rawId);
      }
      for (const rawName of rawNames.slice(0, 50)) {
        if (typeof rawName !== "string" || !rawName.trim()) continue;
        const pattern = sanitizePattern(rawName);
        const { data: matches } = await supabase.from("clients").select("id, full_name, last_contact_at").eq("user_id", userId).ilike("full_name", `%${pattern}%`).limit(6);
        if (!matches || matches.length === 0) { not_found.push(rawName); continue; }
        if (matches.length > 1) {
          // Un match EXACTO (case-insensitive) desambigua solo ("Juan Pérez" vs "Juan Pérez López").
          const exact = (matches as Target[]).filter((m) => m.full_name?.trim().toLowerCase() === rawName.trim().toLowerCase());
          if (exact.length === 1) { targets.push(exact[0]); continue; }
          ambiguous.push({ name: rawName, matches: (matches as Target[]).map((m) => m.full_name) });
          continue;
        }
        targets.push(matches[0] as Target);
      }

      // Dedup por id (mismo cliente llegado por nombre y por id).
      const seenIds = new Set<string>();
      const unique = targets.filter((t) => (seenIds.has(t.id) ? false : (seenIds.add(t.id), true)));

      const kept_more_recent: string[] = [];
      const toMark = unique.filter((t) => {
        if (t.last_contact_at && new Date(t.last_contact_at).getTime() > new Date(when.iso).getTime()) {
          kept_more_recent.push(t.full_name);
          return false;
        }
        return true;
      });

      let marked: string[] = [];
      if (toMark.length > 0) {
        const ids = toMark.map((t) => t.id);
        const { error } = await supabase.from("clients").update({ last_contact_at: when.iso }).in("id", ids).eq("user_id", userId);
        if (error) return JSON.stringify({ error: safeDbError(error) });
        marked = toMark.map((t) => t.full_name);
        // Historial visible en la ficha (misma tabla/action_type que el widget del front). Best-effort.
        const label = when.dateISO === todayCordobaISO() ? "hoy" : `el ${when.dateISO}`;
        await supabase.from("client_activity_log").insert(ids.map((id) => ({ client_id: id, user_id: userId, action_type: "call_logged", description: `Contacto registrado por Alan (${label})` })));
      }

      return JSON.stringify({
        success: true,
        contact_date: when.dateISO,
        marked,
        marked_count: marked.length,
        ...(kept_more_recent.length ? { kept_more_recent, kept_note: "Ya figuraban contactados MÁS recientemente que la fecha informada; el registro más nuevo se conserva (no se retrocede)." } : {}),
        ...(not_found.length ? { not_found } : {}),
        ...(ambiguous.length ? { ambiguous, ambiguous_note: "Hay varios con ese nombre: preguntale al agente cuál es (no adivines) y volvé a llamar con el nombre completo o el id." } : {}),
      });
    }

    case "get_client": {
      if (!args.client_id || !UUID_REGEX.test(args.client_id)) return JSON.stringify({ error: "ID de cliente inválido" });
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("id", args.client_id)
        .eq("user_id", userId)
        .single();
      if (clientError) return JSON.stringify({ error: safeDbError(clientError) });
      registerContact(ctx, (client as any)?.full_name, (client as any)?.phone);
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

      // try/catch propio (patrón send_email, ticket 86aj9w5kh): un throw de red acá NO debe subir
      // al catch genérico ("reintentá") porque el evento pudo haberse creado igual → duplicado.
      let calRes: Response;
      try {
        calRes = await fetch(calUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(eventBody),
        });
      } catch (err) {
        console.error("Calendar create fetch error:", err);
        return JSON.stringify({ error: "Error de red al crear el evento: estado desconocido (puede haberse creado o no). Verificá en Google Calendar antes de reintentar, para no duplicarlo." });
      }
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

      // try/catch propio (patrón send_email, ticket 86aj9w5kh): ver create_calendar_event.
      let calRes: Response;
      try {
        calRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(eventBody),
        });
      } catch (err) {
        console.error("Meet event create fetch error:", err);
        return JSON.stringify({ error: "Error de red al crear la reunión: estado desconocido (puede haberse creado o no). Verificá en Google Calendar antes de reintentar, para no duplicarla." });
      }
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

      // Validación real de destinatarios (anti header-injection CRLF): cada dirección debe pasar la
      // regex de email — una "dirección" con \r\n/espacios (intento de inyectar Bcc/headers) se
      // rechaza acá y el email NO se envía. buildMimeEmail además strippea CRLF (defensa en profundidad).
      // m9: el tope se aplica POR DIRECCIÓN (cantidad), no con slice(0,500) del string crudo — el
      // slice podía cortar una dirección al medio y convertirla en otra (inválida o, peor, válida
      // y ajena). parseEmailList valida cada dirección entera; MAX_EMAIL_RECIPIENTS acota el abuso.
      const MAX_EMAIL_RECIPIENTS = 20;
      const rawTo = typeof args.to === "string" ? args.to.trim() : "";
      const { emails: toEmails, invalid: toInvalid } = parseEmailList(rawTo);
      if (toEmails.length === 0 || toInvalid.length > 0) {
        return JSON.stringify({ error: `Email de destinatario inválido${toInvalid.length ? `: ${toInvalid.join(", ")}` : ""}. Verificá la dirección antes de enviar. El formato es emails puros separados por coma (sin "Nombre <mail>").` });
      }
      if (toEmails.length > MAX_EMAIL_RECIPIENTS) {
        return JSON.stringify({ error: `Demasiados destinatarios (${toEmails.length}): el máximo es ${MAX_EMAIL_RECIPIENTS} por envío.` });
      }
      const to = toEmails.join(", ");
      const subject = typeof args.subject === "string" ? args.subject.trim().slice(0, 500) : null;
      if (!subject) return JSON.stringify({ error: "El asunto es requerido" });
      const rawBody = typeof args.body === "string" ? args.body.trim().slice(0, 50000) : null;
      if (!rawBody) return JSON.stringify({ error: "El cuerpo del email es requerido" });
      // Garantía server-side: strippeamos los marcadores de chat (DRAFT/WHATSAPP_TO/MSG_BREAK)
      // para que NUNCA lleguen al email real del cliente, aunque el modelo los filtre. Ver 86aj1f236.
      const body = stripChatMarkers(rawBody);
      if (!body) return JSON.stringify({ error: "El cuerpo del email es requerido" });
      let cc: string | null = null;
      if (typeof args.cc === "string" && args.cc.trim()) {
        const { emails: ccEmails, invalid: ccInvalid } = parseEmailList(args.cc.trim());
        if (ccEmails.length === 0 || ccInvalid.length > 0) {
          return JSON.stringify({ error: `Email de CC inválido${ccInvalid.length ? `: ${ccInvalid.join(", ")}` : ""}. Corregilo o mandá sin CC.` });
        }
        if (ccEmails.length > MAX_EMAIL_RECIPIENTS) {
          return JSON.stringify({ error: `Demasiados destinatarios en CC (${ccEmails.length}): el máximo es ${MAX_EMAIL_RECIPIENTS}.` });
        }
        cc = ccEmails.join(", ");
      }

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

      // try/catch propio (86aj9w5kh): lectura sin riesgo de duplicado → mensaje de reintento simple.
      let calRes: Response;
      try {
        calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (err) {
        console.error("Calendar list fetch error:", err);
        return JSON.stringify({ error: "Error de red al consultar Google Calendar. Reintentá en un momento." });
      }
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

      // try/catch propio (86aj9w5kh): el GET es lectura → reintento simple.
      let getRes: Response;
      try {
        getRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (err) {
        console.error("Calendar update GET fetch error:", err);
        return JSON.stringify({ error: "Error de red al consultar el evento. Reintentá en un momento." });
      }
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

      // try/catch propio (86aj9w5kh): el PATCH es escritura → estado desconocido, que verifique.
      let patchRes: Response;
      try {
        patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      } catch (err) {
        console.error("Calendar update PATCH fetch error:", err);
        return JSON.stringify({ error: "Error de red al actualizar el evento: estado desconocido (pudo haberse aplicado o no). Verificá el evento en Google Calendar antes de reintentar." });
      }
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
      else {
        // Path por UUID: el id puede venir de una búsqueda vieja y el scraper nocturno
        // borra las propiedades que ya no ve en el listado → validar existencia antes
        // del upsert para no reventar con FK 23503 (bug recurrente 86ak29y3q).
        const { data: propRow } = await supabase.from("properties").select("id").eq("id", resolvedPropertyId).maybeSingle();
        if (!propRow) return JSON.stringify({ error: "Esa propiedad ya no está publicada (se dio de baja del listado). Volvé a buscarla con search_properties y vinculá una versión vigente." });
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
      // Lote de tarjetas (replace misma tool / merge entre tools distintas, ver beginCardBatch/M9)
      // + stub sin url/photo (ver toCardStub / 86ajangkb).
      if ((data ?? []).length > 0) beginCardBatch(ctx, "list_client_properties");
      const client_properties = (data ?? []).map((cp: any) => (cp.properties ? { ...cp, properties: toCardStub(ctx, cp.properties) } : cp));
      return JSON.stringify({ client_properties, total: client_properties.length });
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
          // m7: match EXACTO obligatorio (mismo criterio que delete_client) — el atajo "substring
          // con match único" agendaba en un cliente CUALQUIERA ("Ana" → "Susana Pérez").
          // limit(6) permite reportar "5+" sin traer toda la agenda.
          const { data: found } = await supabase.from("clients").select("id, full_name").eq("user_id", userId).ilike("full_name", `%${search}%`).limit(6);
          if (!found?.length) return JSON.stringify({ error: `No se encontró un cliente con nombre "${args.client_name}"` });
          const exact = exactNameMatches(found as Array<{ id: string; full_name: string | null }>, args.client_name);
          if (exact.length === 1) resolvedClientId = (exact[0] as any).id;
          else if (exact.length > 1) return JSON.stringify({ error: `Hay ${exact.length} clientes con exactamente ese nombre. Identificá cuál (por teléfono/email) y volvé a llamar con el client_id.`, matches: exact });
          else return JSON.stringify({ error: `No encontré una coincidencia EXACTA con "${args.client_name}". Coincidencias parciales (${found.length >= 6 ? "5+" : found.length}): ${found.slice(0, 5).map((c: any) => c.full_name).join(", ")}. Confirmá con el agente el nombre COMPLETO (o usá el client_id) y volvé a llamar.`, matches: found.slice(0, 5) });
        }
      }
      if (!resolvedClientId || !UUID_REGEX.test(resolvedClientId)) return JSON.stringify({ error: "Se requiere client_id o client_name" });
      // Pertenencia ANTES de cualquier efecto (incluido el sync a Calendar de más abajo):
      // el path por UUID directo no pasaba por ninguna query scopeada (86aj9w5ke).
      if (!(await assertClientOwned(supabase, userId, resolvedClientId))) {
        return JSON.stringify({ error: "Cliente no encontrado o no te pertenece." });
      }

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
          // m7: match EXACTO obligatorio (mismo criterio que delete_client) — el atajo "substring
          // con match único" anotaba en un cliente CUALQUIERA ("Ana" → "Susana Pérez").
          // limit(6) permite reportar "5+" sin traer toda la agenda.
          const { data: found } = await supabase.from("clients").select("id, full_name").eq("user_id", userId).ilike("full_name", `%${search}%`).limit(6);
          if (!found?.length) return JSON.stringify({ error: `No encontré un cliente con nombre "${args.client_name}"` });
          const exact = exactNameMatches(found as Array<{ id: string; full_name: string | null }>, args.client_name);
          if (exact.length === 1) clientId = (exact[0] as any).id;
          else if (exact.length > 1) return JSON.stringify({ error: `Hay ${exact.length} clientes con exactamente ese nombre. Identificá cuál (por teléfono/email) y volvé a llamar con el client_id.`, matches: exact });
          else return JSON.stringify({ error: `No encontré una coincidencia EXACTA con "${args.client_name}". Coincidencias parciales (${found.length >= 6 ? "5+" : found.length}): ${found.slice(0, 5).map((c: any) => c.full_name).join(", ")}. Confirmá con el agente el nombre COMPLETO (o usá el client_id) y volvé a llamar.`, matches: found.slice(0, 5) });
        }
      }
      if (!clientId || !UUID_REGEX.test(clientId)) return JSON.stringify({ error: "Se necesita un client_id o client_name válido" });
      // Pertenencia en el path por UUID directo (86aj9w5ke): sin esto, service_role permite
      // colgar notas del cliente de otro agente.
      if (!(await assertClientOwned(supabase, userId, clientId))) {
        return JSON.stringify({ error: "Cliente no encontrado o no te pertenece." });
      }
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

    // ---- Borrado de clientes / contactos ----
    case "delete_client": {
      // Resuelve por client_id directo o por nombre (NO filtra is_client: se puede borrar
      // tanto un cliente como un contacto). Si el nombre matchea varios, devuelve la lista
      // para desambiguar y NO borra nada. Scoping por user_id en cada query.
      let resolvedClientId = args.client_id;
      let resolvedName: string | null = null;
      if (!resolvedClientId || !UUID_REGEX.test(resolvedClientId)) {
        if (!args.client_name) return JSON.stringify({ error: "Necesito el nombre o ID del cliente/contacto a borrar." });
        const searchName = sanitizePattern(args.client_name);
        // m8: consulta previa por nombre EXACTO (ilike sin comodines = igualdad case-insensitive)
        // ADEMÁS del listado difuso: en agendas con muchos homónimos parciales, el match exacto
        // podía quedar FUERA del limit(10) del difuso y el borrado legítimo se volvía imposible.
        const [{ data: exactRows }, { data: fuzzyRows }] = await Promise.all([
          supabase.from("clients").select("id, full_name, is_client").eq("user_id", userId).ilike("full_name", searchName).limit(10),
          supabase.from("clients").select("id, full_name, is_client").eq("user_id", userId).ilike("full_name", `%${searchName}%`).limit(10),
        ]);
        const seenIds = new Set<string>();
        const matches: Array<{ id: string; full_name: string | null; is_client: boolean | null }> = [];
        for (const r of [...(exactRows ?? []), ...(fuzzyRows ?? [])]) {
          if (seenIds.has(r.id)) continue;
          seenIds.add(r.id);
          matches.push(r);
        }
        if (matches.length === 0) return JSON.stringify({ error: `No encontré ningún cliente ni contacto con el nombre "${args.client_name}".` });
        // Borrado IRREVERSIBLE (CASCADE) → SOLO se ejecuta con match EXACTO del nombre completo
        // (case/acento-insensible vía nameDedupKey). Un substring NUNCA borra: antes "Ana" con un
        // único match parcial borraba a "Susana Pérez" con todos sus datos.
        const exact = exactNameMatches(matches as Array<{ id: string; full_name: string | null }>, args.client_name);
        if (exact.length === 1) {
          resolvedClientId = (exact[0] as any).id;
          resolvedName = exact[0].full_name;
        } else if (exact.length > 1) {
          return JSON.stringify({ error: `Hay ${exact.length} registros con exactamente ese nombre. Pedile al agente que identifique cuál (por teléfono/email) y borrá por ID.`, matches: exact });
        } else {
          return JSON.stringify({ error: `No encontré una coincidencia EXACTA con "${args.client_name}". Coincidencias parciales: ${matches.map((c) => c.full_name).join(", ")}. Borrar es irreversible: confirmá con el agente el NOMBRE COMPLETO exacto (o el ID) antes de volver a llamar.`, matches });
        }
      }
      if (!resolvedName) {
        const { data: c } = await supabase.from("clients").select("full_name").eq("id", resolvedClientId).eq("user_id", userId).maybeSingle();
        if (!c) return JSON.stringify({ error: "Cliente/contacto no encontrado o no te pertenece." });
        resolvedName = c.full_name;
      }
      // El ON DELETE CASCADE de la DB limpia notas, tareas, propiedades vinculadas y eventos.
      // Las conversaciones quedan (client_id pasa a NULL por ON DELETE SET NULL).
      const { error } = await supabase.from("clients").delete().eq("id", resolvedClientId).eq("user_id", userId);
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, message: `"${resolvedName}" y todos sus datos asociados fueron eliminados.` });
    }

    case "delete_all_clients": {
      // Borrado masivo "empezar de cero". Doble barrera: el prompt exige confirmación verbal
      // del agente Y la tool exige confirm===true. Sin confirm devuelve solo el conteo (no borra).
      // SIEMPRE scopeado por user_id → nunca toca data de otros agentes.
      const kind = ["client", "contact", "all"].includes(args.kind) ? args.kind : "all";
      const status = VALID_CLIENT_STATUSES.includes(args.status) ? args.status : null;
      const applyFilter = (q: any) => {
        q = q.eq("user_id", userId);
        if (kind === "client") q = q.eq("is_client", true);
        else if (kind === "contact") q = q.eq("is_client", false);
        if (status) q = q.eq("status", status);
        return q;
      };
      const label = kind === "contact" ? "contactos" : kind === "client" ? "clientes" : "clientes y contactos";
      const statusLabel = status ? ` en estado ${status}` : "";

      // Conteo real (head:true → sin traer filas).
      const { count, error: countError } = await applyFilter(supabase.from("clients").select("*", { count: "exact", head: true }));
      if (countError) return JSON.stringify({ error: safeDbError(countError) });
      const total = count ?? 0;
      if (total === 0) return JSON.stringify({ success: true, deleted_count: 0, message: `No tenés ${label}${statusLabel} para borrar.` });

      if (args.confirm !== true) {
        return JSON.stringify({
          pending_confirmation: true,
          would_delete: total,
          message: `⚠️ Esto va a borrar ${total} ${label}${statusLabel} y NO se puede deshacer. Avisale al agente cuántos son y pedí confirmación EXPLÍCITA antes de volver a llamar la herramienta con confirm=true.`,
        });
      }

      const { error } = await applyFilter(supabase.from("clients").delete());
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, deleted_count: total, message: `Listo, borré ${total} ${label}${statusLabel}. Empezás de cero.` });
    }

    default:
      return JSON.stringify({ error: "Tool not found" });
  }
}
