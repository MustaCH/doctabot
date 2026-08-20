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
  neutralizeControlMarkers,
  sanitizeExternalPortalResult,
  normalizeOperation,
  stripChatMarkers,
  phoneDedupKey,
  nameDedupKey,
  prepareContactBatch,
  exactNameMatches,
  parseEmailList,
  titleFallbackRegex,
} from "./validators.ts";
import {
  extractMeetLink,
  buildCalendarEvent,
  parseEventDates,
  buildMimeEmail,
} from "./google.ts";
import { CLIENT_EVENT_TYPES, CLIENT_EVENT_RECURRENCES } from "../alan-facts.ts";
import { normalizePhone } from "../whatsapp-guardrail.ts";
import { computeMarketStats, daysOnMarket, priceVsMedian } from "./market.ts";

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
    // Hybrid search (86aj9w5pn): embedding L2-normalizado (768 dims) de un texto de consulta,
    // o null si no se pudo (fail-open). Lo inyecta index.ts (Gemini gemini-embedding-001);
    // lo usa el reintento por relevancia de search_properties para la RPC v3.
    embedQuery?: (text: string) => Promise<number[] | null>;
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
      // Paginación ("mostrame más"): OFFSET server-side de la RPC — el orden (docta, relevance,
      // created_at) es el mismo en todas las páginas, así que páginas consecutivas no se solapan
      // ni saltean (sucesor del viejo esquema B1 de pool + re-rankeo en memoria).
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

      // Params de la RPC v2 `search_properties_relevance` (migración 20260819100000): UNA llamada
      // trae página + total_count (window) con orden server-side (docta DESC, relevance DESC,
      // created_at DESC) y paginación. Cada filtro replica 1:1 la semántica del viejo query-builder
      // (ilike-substring para tipos, exclude_office con office-IS-NULL-pasa, only_active = active
      // O NULL legacy, eq exacto para regímenes canónicos de operación con fallback ILIKE —
      // ver tickets 86aj1f1fy / m1 / 86ak2q73x).
      const rpcParams: Record<string, unknown> = {
        search_term: "",
        zones: zones.length > 1 ? zones : zone ? [zone] : null,
        exclude_zones: excludeZones.length ? excludeZones : null,
        exclude_neighborhoods: excludeNeighborhoods.length ? excludeNeighborhoods : null,
        locality_filter: locality ?? "",
        neighborhood_filter: neighborhood ?? "",
        city_filter: city ?? "",
        op_filter: canonicalOperation ?? "",
        op_filter_like: operation && !canonicalOperation ? operation : "",
        property_types: propertyTypes.length > 1 ? propertyTypes : property_type ? [property_type] : null,
        title_filter: titleSearch ?? "",
        price_min: min_price,
        price_max: max_price,
        currency_filter: currency ?? "",
        rooms_min: min_habitaciones,
        rooms_max: max_habitaciones,
        amb_min: min_ambientes,
        amb_max: max_ambientes,
        office_filter: office ?? "",
        exclude_office_filter: excludeOffice ?? "",
        filter_active: onlyActive,
        docta_first: doctaFirst,
        page_size: limit,
        page_offset: offset,
      };
      const runSearch = (overrides: Record<string, unknown>): Promise<{ data: any[] | null; error: any }> =>
        supabase.rpc("search_properties_relevance", { ...rpcParams, ...overrides });

      // price_unset_count ("a consultar"): la RPC no puede expresar price IS NULL, así que este
      // ÚNICO count auxiliar sigue en PostgREST, replicando los filtros no-precio de la RPC
      // (equivale al viejo skipPrice: sin min/max_price ni currency).
      const countPriceUnset = async (): Promise<number> => {
        let q = supabase.from("properties").select("*", { count: "exact", head: true });
        if (onlyActive) q = q.or("listing_status.eq.active,listing_status.is.null");
        if (zones.length > 1) q = q.or(zones.map((z) => `zone.ilike.%${z}%`).join(","));
        else if (zone) q = q.ilike("zone", `%${zone}%`);
        for (const z of excludeZones) q = q.not("zone", "ilike", `%${z}%`);
        for (const n of excludeNeighborhoods) q = q.not("zone_neighborhood", "ilike", `%${n}%`);
        if (locality) q = q.ilike("locality", `%${locality}%`);
        if (neighborhood) q = q.ilike("zone_neighborhood", `%${neighborhood}%`);
        if (city) q = q.ilike("zone_city", `%${city}%`);
        if (titleSearch) q = q.ilike("title", `%${titleSearch}%`);
        if (operation) {
          if (canonicalOperation) q = q.eq("operation", canonicalOperation);
          else q = q.ilike("operation", `%${operation}%`);
        }
        if (propertyTypes.length > 1) q = q.or(propertyTypes.map((t) => `property_type.ilike.%${t}%`).join(","));
        else if (property_type) q = q.ilike("property_type", `%${property_type}%`);
        if (min_ambientes !== null) q = q.gte("ambientes", min_ambientes);
        if (max_ambientes !== null) q = q.lte("ambientes", max_ambientes);
        if (min_habitaciones !== null) q = q.gte("habitaciones", min_habitaciones);
        if (max_habitaciones !== null) q = q.lte("habitaciones", max_habitaciones);
        if (office) q = q.ilike("office", `%${office}%`);
        if (excludeOffice) {
          // m1: office IS NULL también pasa; término saneado para que el string de .or() no sea inyectable.
          const exOr = excludeOffice.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
          if (exOr) q = q.or(`office.is.null,office.not.ilike.%${exOr}%`);
        }
        const { count } = await q.is("price", null);
        return count ?? 0;
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

      // Búsqueda principal: la RPC devuelve la página ya ordenada y paginada, con total_count
      // (window sobre el universo filtrado) repetido en cada fila.
      const { data: rpcData, error: rpcError } = await runSearch({});
      let data: any[] | null = rpcData ?? null;
      const error = rpcError;
      let totalCount = data && data.length > 0 ? Number(data[0].total_count ?? 0) : 0;
      // Cuando los resultados provienen de un reintento por relevancia (no por zona/localidad
      // exacta), lo etiquetamos para que Alan lo aclare en vez de presentarlo como match exacto.
      // Ver 86aj1f1w6.
      let titleFallbackTerm: string | null = null;

      // Fallback por relevancia (86aj9w5mz reexpresado sobre la RPC, ticket 86ak2q73x): un término
      // de ubicación sin resultados puede ser un desarrollo/loteo que vive en el título, o un typo.
      // MISMO gate anti-espurios (titleFallbackRegex: ≥4 chars, fuera de la blocklist — 'centro'/
      // 'san' no disparan); el matching pasa de imatch word-boundary a search_term con umbral de
      // relevance_score (la RPC exige rel ≥ 0.25 o substring en título), que además absorbe typos
      // ('manantiles' → 'Manantiales'). Precedencia histórica: locality > neighborhood > zone.
      if (!error && (!data || data.length === 0) && !titleSearch) {
        const fallback =
          locality && titleFallbackRegex(locality)
            ? { term: locality, clear: { locality_filter: "" } }
            : neighborhood && !locality && titleFallbackRegex(neighborhood)
              ? { term: neighborhood, clear: { neighborhood_filter: "" } }
              : zone && !locality && !neighborhood && titleFallbackRegex(zone)
                ? { term: zone, clear: { zones: null } }
                : null;
        if (fallback) {
          // Hybrid search (86aj9w5pn): si el caller inyectó embedQuery (index.ts → Gemini
          // embeddings), sumamos recall vectorial al reintento — la RPC v3 combina
          // 0.6·trigram + 0.4·coseno por fila CON embedding backfilleado. Fail-open total:
          // sin embedQuery, con error de la API o filas sin backfill, el reintento es el
          // trigram puro de siempre.
          let queryEmbedding: number[] | null = null;
          if (typeof ctx.embedQuery === "function") {
            try { queryEmbedding = await ctx.embedQuery(fallback.term); } catch { queryEmbedding = null; }
          }
          const { data: fbData, error: fbError } = await runSearch({
            ...fallback.clear,
            search_term: fallback.term,
            ...(queryEmbedding ? { query_embedding: queryEmbedding } : {}),
          });
          if (!fbError && fbData && fbData.length > 0) {
            data = fbData;
            totalCount = Number(fbData[0].total_count ?? 0);
            titleFallbackTerm = fallback.term;
          }
        }
      }

      if (error) return JSON.stringify({ error: safeDbError(error) });
      if (!data || data.length === 0) {
        // M6: 0 resultados limpia el lote de tarjetas del turno — sin esto, el expansor anexaba
        // las tarjetas de una tool ANTERIOR debajo de un "no encontré".
        clearCardBatch(ctx);
        // M5: con offset > 0 y universo real > 0 no es "sin resultados": es el FIN de la
        // paginación. Sin filas no hay total_count (es window de la página): el universo
        // requiere una sonda aparte con page_offset=0.
        if (offset > 0) {
          const { data: probe } = await runSearch({ page_size: 1, page_offset: 0 });
          const universe = probe && probe.length > 0 ? Number(probe[0].total_count ?? 0) : 0;
          if (universe > 0) {
            return JSON.stringify({
              end_of_results: true,
              total_count: universe,
              showing: 0,
              applied_filters,
              ...(ignored_filters.length ? { ignored_filters } : {}),
              message: "No hay más resultados: ya se mostraron todas las propiedades de esta búsqueda.",
            });
          }
        }
        // 0 resultados: si había al menos un filtro numérico, reintentamos 1-2 sondas de la RPC
        // (page_size=1, solo para leer total_count) relajando el filtro más probable (primero
        // max_price, después min_habitaciones/ambientes) para que Alan ofrezca una relajación
        // concreta ("hay N opciones si subís ~15%"). Solo devolvemos hints con count>0. 86aj1f1fy.
        const hasNumericFilter = [min_price, max_price, min_ambientes, max_ambientes, min_habitaciones, max_habitaciones].some((v) => v !== null);
        const relax_hints: Array<{ drop: string; count: number }> = [];
        const relaxCount = async (overrides: Record<string, unknown>): Promise<number> => {
          const { data: rows } = await runSearch({ ...overrides, page_size: 1, page_offset: 0 });
          return rows && rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
        };
        if (hasNumericFilter) {
          if (max_price !== null) {
            const count = await relaxCount({ price_max: null });
            if (count > 0) relax_hints.push({ drop: "max_price", count });
          }
          if (min_habitaciones !== null || min_ambientes !== null) {
            const count = await relaxCount({ rooms_min: null, amb_min: null });
            if (count > 0) relax_hints.push({ drop: min_habitaciones !== null ? "min_habitaciones" : "min_ambientes", count });
          }
        }
        // price_unset_count también en el camino de 0 resultados: un rango de precio puede haber
        // dejado afuera SOLO las "a consultar" — dato clave para que Alan ofrezca algo.
        let price_unset_count0 = 0;
        if (min_price !== null || max_price !== null) {
          price_unset_count0 = await countPriceUnset();
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
      // filtros base (sin el fallback por relevancia: caso borde, se prefiere simple y honesto).
      let price_unset_count = 0;
      if ((min_price !== null || max_price !== null) && !titleFallbackTerm) {
        price_unset_count = await countPriceUnset();
      }

      // La RPC ya ordenó (docta DESC, relevance DESC, created_at DESC) y paginó server-side:
      // el orden es estable entre páginas sin pool ni re-rankeo en memoria (reemplaza a B1).
      const doctaCount = data.filter((p: any) => p.office?.toLowerCase().includes("docta")).length;
      // Lote de tarjetas del turno: búsquedas sucesivas REEMPLAZAN ("última búsqueda gana"); si el
      // lote venía de OTRA tool con resultados, se fusiona con dedup — ver beginCardBatch (M9).
      beginCardBatch(ctx, "search_properties");
      // Cada resultado se registra y se devuelve como stub con `ref` (sin url/photo): el modelo
      // muestra la propiedad emitiendo <<<CARD:ref>>>, no escribiendo la tarjeta. Ver toCardStub /
      // 86ajangkb. total_count es metadato de la window (no parte del shape de propiedad) y se
      // separa; relevance_score SÍ se expone en cada resultado (AC de 86aj9w5nx).
      const results = data.map((p: any) => {
        const { total_count: _tc, ...row } = p;
        return toCardStub(ctx, row);
      });

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

    // ---- Inteligencia de mercado dinámica (86aj9w5pv) ----
    // Valores de referencia calculados sobre `properties` REALES con fecha, en reemplazo de los
    // precios hardcodeados que vivían en el prompt (viejos y afirmados con seguridad). Solo
    // lectura; la tabla properties es compartida (listado de mercado), no se scopea por user.
    case "market_stats": {
      const stripAccents = (s: string | null) => s ? s.normalize("NFD").replace(/[̀-ͯ]/g, "") : s;
      const zone = stripAccents(sanitizePattern(args.zone));
      const property_type = sanitizePattern(args.property_type);
      const operation = sanitizePattern(args.operation);
      const canonicalOperation = normalizeOperation(operation);
      if (!zone && !property_type) return JSON.stringify({ error: "Pasá al menos una zona o un tipo de propiedad para calcular valores de referencia." });
      let q = supabase
        .from("properties")
        .select("price, currency, m2_total, created_at")
        .or("listing_status.eq.active,listing_status.is.null")
        .limit(1000);
      if (zone) q = q.ilike("zone", `%${zone}%`);
      if (property_type) q = q.ilike("property_type", `%${property_type}%`);
      if (operation) {
        if (canonicalOperation) q = q.eq("operation", canonicalOperation);
        else q = q.ilike("operation", `%${operation}%`);
      }
      const { data, error } = await q;
      if (error) return JSON.stringify({ error: safeDbError(error) });
      const rows = data ?? [];
      const filters = { zone: zone ?? null, property_type: property_type ?? null, operation: canonicalOperation ?? operation ?? null };
      if (rows.length === 0) {
        return JSON.stringify({ filters, sample: 0, message: "No hay propiedades publicadas que matcheen esos filtros: no se pueden calcular valores de referencia. Decílo con honestidad — NO inventes números de memoria." });
      }
      const stats = computeMarketStats(rows);
      return JSON.stringify({
        filters,
        ...stats,
        instruction: "Datos REALES de la base al día de hoy. Citá mediana y rango (p25–p75) con moneda y tamaño de muestra; si la muestra es chica (<8) aclaralo como referencia limitada. NUNCA mezcles USD con ARS ni afirmes valores que no estén en estos números.",
      });
    }

    case "negotiation_brief": {
      const stripAccents = (s: string | null) => s ? s.normalize("NFD").replace(/[̀-ͯ]/g, "") : s;
      // Resolución de propiedad por id o título/dirección (mismo patrón que save_property_to_client).
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
      const { data: propRow, error: propErr } = await supabase.from("properties").select("*").eq("id", resolvedPropertyId).maybeSingle();
      if (propErr) return JSON.stringify({ error: safeDbError(propErr) });
      if (!propRow) return JSON.stringify({ error: "Esa propiedad ya no está publicada (se dio de baja del listado). Volvé a buscarla con search_properties." });

      // Comps: misma zona + tipo + operación, activas, excluyendo la propiedad target.
      let cq = supabase
        .from("properties")
        .select("id, price, currency, m2_total, created_at")
        .or("listing_status.eq.active,listing_status.is.null")
        .limit(1000);
      const compZone = stripAccents(sanitizePattern(propRow.zone));
      const compType = sanitizePattern(propRow.property_type);
      if (compZone) cq = cq.ilike("zone", `%${compZone}%`);
      if (compType) cq = cq.ilike("property_type", `%${compType}%`);
      if (propRow.operation) cq = cq.eq("operation", propRow.operation);
      const { data: compRows, error: compErr } = await cq;
      if (compErr) return JSON.stringify({ error: safeDbError(compErr) });
      const comps = (compRows ?? []).filter((r: { id: string }) => String(r.id) !== String(propRow.id));
      const market = computeMarketStats(comps);

      // Cliente (opcional): por id o nombre, SIEMPRE scopeado por user_id. Sin cliente el brief
      // sale igual (solo comps); con cliente suma presupuesto real + qué visitó/descartó.
      let clientBlock: Record<string, unknown> | null = null;
      let resolvedClientId = args.client_id && UUID_REGEX.test(args.client_id) ? args.client_id : null;
      if (!resolvedClientId && args.client_name) {
        const searchName = sanitizePattern(args.client_name);
        const { data: clients } = await supabase.from("clients").select("id, full_name").eq("user_id", userId).eq("is_client", true).ilike("full_name", `%${searchName}%`).limit(5);
        if (!clients || clients.length === 0) return JSON.stringify({ error: `No encontré un cliente con el nombre "${args.client_name}".` });
        if (clients.length > 1) return JSON.stringify({ error: `Encontré ${clients.length} clientes: ${clients.map((c: { full_name: string | null }) => c.full_name).join(", ")}. ¿Cuál querés?`, clients });
        resolvedClientId = clients[0].id;
      }
      if (resolvedClientId) {
        const { data: client } = await supabase
          .from("clients")
          .select("id, full_name, status, client_type, budget_min, budget_max, budget_currency, preferred_zones, property_type_interest")
          .eq("id", resolvedClientId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!client) return JSON.stringify({ error: "Cliente no encontrado o no te pertenece." });
        const { data: history } = await supabase
          .from("client_properties")
          .select("status, notes, created_at, properties(title, price, currency, zone, property_type)")
          .eq("client_id", resolvedClientId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(30);
        type HistoryRow = { status: string; notes: string | null; properties: { title?: string | null; price?: number | null; currency?: string | null; zone?: string | null } | null };
        const byStatus = (st: string) => ((history ?? []) as HistoryRow[])
          .filter((h) => h.status === st)
          .map((h) => ({ title: h.properties?.title ?? null, price: h.properties?.price ?? null, currency: h.properties?.currency ?? null, zone: h.properties?.zone ?? null, notes: h.notes ?? null }));
        clientBlock = {
          full_name: client.full_name,
          status: client.status,
          client_type: client.client_type,
          budget: { min: client.budget_min ?? null, max: client.budget_max ?? null, currency: client.budget_currency ?? null },
          preferred_zones: client.preferred_zones ?? null,
          property_type_interest: client.property_type_interest ?? null,
          visitadas: byStatus("visitada"),
          descartadas: byStatus("descartada"),
        };
      }

      // La property va SIN url/photo (misma razón que toCardStub: el link solo sale de tarjetas
      // o generate_report — un brief no debe darle al modelo material para escribirlo a mano).
      const { url: _url, photo: _photo, photos: _photos, ...propSafe } = propRow;
      return JSON.stringify({
        property: propSafe,
        days_on_market: daysOnMarket(propRow.created_at),
        market: { comps_sample: comps.length, ...market, median_days_on_market_comps: market.median_days_on_market },
        price_vs_median_pct: priceVsMedian(propRow.price, propRow.currency, market),
        client: clientBlock,
        instruction: "Armá un brief de negociación en prosa (NO tarjeta con emojis): posición del precio vs la mediana de comps (citá % y tamaño de muestra), días en mercado de la propiedad vs la mediana de la zona, y — si hay cliente — su presupuesto real y qué visitó/descartó (usalo para anticipar objeciones). SOLO estos datos; si falta algo, decílo. Sin links (van por tarjetas o generate_report).",
      });
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
      return JSON.stringify({ property: data, instruction: "Generá una ficha profesional y detallada de esta propiedad para compartir con el cliente, en PROSA organizada (NO formato tarjeta: nada de título con 🏠 ni líneas Precio:/Ubicación:/Superficie:). Envolvé TODA la ficha entre <<<DRAFT_START>>> y <<<DRAFT_END>>> (cada marcador solo en su línea) para que sea un texto copiable. Incluí el link de la propiedad con la atribución ?associate." });
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

    // Memoria de cliente entre conversaciones (86aj9w5nu): recupera el HISTORIAL de trabajo con
    // un cliente — el ai_summary generado post-turno + notas recientes + propiedades por estado —
    // resolviendo por NOMBRE (get_client exige UUID). Para "¿en qué quedamos con X?" o trabajar
    // "para X" sin vincular la conversación. Solo lectura, todo scopeado por user_id.
    case "recall_client_history": {
      let resolvedClientId = args.client_id && UUID_REGEX.test(args.client_id) ? args.client_id : null;
      if (!resolvedClientId) {
        if (!args.client_name) return JSON.stringify({ error: "Necesito el nombre o ID del cliente." });
        const searchName = sanitizePattern(args.client_name);
        const { data: clients } = await supabase.from("clients").select("id, full_name").eq("user_id", userId).ilike("full_name", `%${searchName}%`).limit(5);
        if (!clients || clients.length === 0) return JSON.stringify({ error: `No encontré un cliente con el nombre "${args.client_name}".` });
        if (clients.length > 1) return JSON.stringify({ error: `Encontré ${clients.length} clientes: ${clients.map((c: { full_name: string | null }) => c.full_name).join(", ")}. ¿Cuál querés?`, clients });
        resolvedClientId = clients[0].id;
      }
      const { data: recallClient } = await supabase
        .from("clients")
        .select("id, full_name, status, client_type, phone, email, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, notes, last_contact_at, ai_summary, ai_summary_updated_at")
        .eq("id", resolvedClientId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!recallClient) return JSON.stringify({ error: "Cliente no encontrado o no te pertenece." });
      registerContact(ctx, recallClient.full_name, recallClient.phone);
      const [{ data: recentNotes }, { data: linkedProps }] = await Promise.all([
        supabase
          .from("client_notes")
          .select("content, is_action, is_done, created_at")
          .eq("client_id", resolvedClientId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("client_properties")
          .select("status, notes, created_at, properties(title, price, currency, zone, operation)")
          .eq("client_id", resolvedClientId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      type LinkedRow = { status: string; notes: string | null; created_at: string; properties: { title?: string | null; price?: number | null; currency?: string | null; zone?: string | null; operation?: string | null } | null };
      const propiedades = ((linkedProps ?? []) as LinkedRow[]).map((cp) => ({
        status: cp.status,
        title: cp.properties?.title ?? null,
        price: cp.properties?.price ?? null,
        currency: cp.properties?.currency ?? null,
        zone: cp.properties?.zone ?? null,
        notes: cp.notes ?? null,
      }));
      return JSON.stringify({
        client: recallClient,
        memoria: recallClient.ai_summary ?? null,
        memoria_actualizada: recallClient.ai_summary_updated_at ?? null,
        notas_recientes: recentNotes ?? [],
        propiedades_vinculadas: propiedades,
        instruction: "Este es el historial REAL de trabajo con el cliente (la 'memoria' la genera el sistema tras cada conversación vinculada). Usalo para retomar el hilo sin re-preguntar lo ya hablado; si la memoria está vacía, decí que todavía no hay historial registrado — no lo inventes.",
      });
    }

    // ---- Multimodal estructurado (86aj9w5pp) ----
    // La VISIÓN la hace el modelo en el turno (la imagen/PDF viaja en el mensaje multimodal);
    // estas tools son el CONTRATO de salida + la persistencia: validan el JSON tipado que el
    // modelo extrajo y lo guardan en media_analyses (vinculación opcional a cliente/propiedad,
    // siempre scopeado por user_id).
    case "analyze_property_media": {
      const VALID_ESTADOS = ["excelente", "muy bueno", "bueno", "regular", "a refaccionar"];
      const estadoRaw = typeof args.estado_general === "string" ? args.estado_general.trim().toLowerCase() : "";
      const estado_general = VALID_ESTADOS.includes(estadoRaw) ? estadoRaw : null;
      const strCap = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
      const analysis: Record<string, unknown> = {
        tipo_espacio: strCap(args.tipo_espacio, 100),
        ambientes: safePositiveInt(args.ambientes),
        dormitorios: safePositiveInt(args.dormitorios),
        banos: safePositiveInt(args.banos),
        estado_general,
        ...(estado_general === null && estadoRaw ? { estado_general_invalido: estadoRaw.slice(0, 50) } : {}),
        features: Array.isArray(args.features) ? args.features.filter((f: unknown) => typeof f === "string" && f.trim()).map((f: string) => f.trim().slice(0, 120)).slice(0, 25) : [],
        observaciones: strCap(args.observaciones, 2000),
      };
      if (analysis.ambientes === null && analysis.dormitorios === null && !estado_general && (analysis.features as string[]).length === 0 && !analysis.observaciones) {
        return JSON.stringify({ error: "El análisis viene vacío: mirá la imagen y completá al menos estado_general, ambientes/dormitorios o features con lo que se VE (no inventes lo que no se ve)." });
      }
      // Vinculación opcional a cliente (por id o nombre) y/o propiedad — validando ownership/existencia.
      let mediaClientId: string | null = null;
      if (args.client_id && UUID_REGEX.test(args.client_id)) {
        const owned = await assertClientOwned(supabase, userId, args.client_id);
        if (!owned) return JSON.stringify({ error: "Cliente no encontrado o no te pertenece." });
        mediaClientId = args.client_id;
      } else if (args.client_name) {
        const searchName = sanitizePattern(args.client_name);
        const { data: clients } = await supabase.from("clients").select("id, full_name").eq("user_id", userId).ilike("full_name", `%${searchName}%`).limit(5);
        if (clients?.length === 1) mediaClientId = clients[0].id;
        else if ((clients?.length ?? 0) > 1) return JSON.stringify({ error: `Encontré ${clients.length} clientes: ${clients.map((c: { full_name: string | null }) => c.full_name).join(", ")}. ¿A cuál vinculo el análisis?`, clients });
      }
      let mediaPropertyId: string | null = null;
      if (args.property_id && UUID_REGEX.test(args.property_id)) {
        const { data: propRow } = await supabase.from("properties").select("id").eq("id", args.property_id).maybeSingle();
        if (propRow) mediaPropertyId = args.property_id;
      }
      const { data: saved, error: saveErr } = await supabase
        .from("media_analyses")
        .insert({ user_id: userId, conversation_id: conversationId || null, client_id: mediaClientId, property_id: mediaPropertyId, kind: "property_media", source_label: strCap(args.source_label, 200), analysis })
        .select("id")
        .maybeSingle();
      if (saveErr) return JSON.stringify({ error: safeDbError(saveErr) });
      return JSON.stringify({
        success: true,
        saved_id: saved?.id ?? null,
        linked_client: mediaClientId !== null,
        linked_property: mediaPropertyId !== null,
        analysis,
        instruction: "Análisis guardado. Presentale al agente el resultado en prosa/lista clara (NO formato tarjeta de propiedad): estado, ambientes y features detectados + observaciones. Si no quedó vinculado a un cliente/propiedad y el contexto lo sugiere, ofrecé vincularlo.",
      });
    }

    case "extract_document": {
      const VALID_DOC_TYPES = ["boleto", "tasacion", "plano", "escritura", "contrato_alquiler", "otro"];
      const docTypeRaw = typeof args.doc_type === "string" ? args.doc_type.trim().toLowerCase() : "";
      const doc_type = VALID_DOC_TYPES.includes(docTypeRaw) ? docTypeRaw : "otro";
      const strCap2 = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
      type MontoArg = { concepto?: unknown; valor?: unknown; moneda?: unknown };
      type FechaArg = { concepto?: unknown; fecha?: unknown };
      const montos = Array.isArray(args.montos)
        ? (args.montos as MontoArg[])
            .filter((m) => m && typeof m === "object" && typeof m.valor === "number" && Number.isFinite(m.valor))
            .map((m) => ({ concepto: strCap2(m.concepto, 120) ?? "monto", valor: m.valor as number, moneda: strCap2(m.moneda, 10) ?? "USD" }))
            .slice(0, 15)
        : [];
      const fechas = Array.isArray(args.fechas)
        ? (args.fechas as FechaArg[])
            .filter((f) => f && typeof f === "object" && typeof f.fecha === "string")
            .map((f) => ({ concepto: strCap2(f.concepto, 120) ?? "fecha", fecha: String(f.fecha).slice(0, 30) }))
            .slice(0, 15)
        : [];
      const analysis: Record<string, unknown> = {
        doc_type,
        partes: Array.isArray(args.partes) ? args.partes.filter((p: unknown) => typeof p === "string" && p.trim()).map((p: string) => p.trim().slice(0, 200)).slice(0, 10) : [],
        montos,
        fechas,
        direccion: strCap2(args.direccion, 300),
        superficie_m2: safePositiveNumber(args.superficie_m2),
        plazos: strCap2(args.plazos, 500),
        observaciones: strCap2(args.observaciones, 2000),
      };
      if ((analysis.partes as string[]).length === 0 && montos.length === 0 && fechas.length === 0 && !analysis.direccion && !analysis.observaciones) {
        return JSON.stringify({ error: "La extracción viene vacía: leé el documento y completá los campos con lo que DICE (partes, montos, fechas). Si no pudiste leerlo, decílo en vez de llamar la tool." });
      }
      let docClientId: string | null = null;
      if (args.client_id && UUID_REGEX.test(args.client_id)) {
        const owned = await assertClientOwned(supabase, userId, args.client_id);
        if (!owned) return JSON.stringify({ error: "Cliente no encontrado o no te pertenece." });
        docClientId = args.client_id;
      } else if (args.client_name) {
        const searchName = sanitizePattern(args.client_name);
        const { data: clients } = await supabase.from("clients").select("id, full_name").eq("user_id", userId).ilike("full_name", `%${searchName}%`).limit(5);
        if (clients?.length === 1) docClientId = clients[0].id;
        else if ((clients?.length ?? 0) > 1) return JSON.stringify({ error: `Encontré ${clients.length} clientes: ${clients.map((c: { full_name: string | null }) => c.full_name).join(", ")}. ¿A cuál vinculo el documento?`, clients });
      }
      const { data: savedDoc, error: docErr } = await supabase
        .from("media_analyses")
        .insert({ user_id: userId, conversation_id: conversationId || null, client_id: docClientId, property_id: null, kind: "document", doc_type, source_label: strCap2(args.source_label, 200), analysis })
        .select("id")
        .maybeSingle();
      if (docErr) return JSON.stringify({ error: safeDbError(docErr) });
      return JSON.stringify({
        success: true,
        saved_id: savedDoc?.id ?? null,
        linked_client: docClientId !== null,
        analysis,
        instruction: "Extracción guardada. Resumile al agente lo clave del documento (partes, montos con moneda, fechas/plazos) en prosa clara y SEÑALÁ lo que falte o esté ilegible. Los datos legales finos requieren verificación profesional (escribano): aclaralo si aplica.",
      });
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
      // due_at: vencimiento de la TAREA — lo consume daily-followups para recordar tareas
      // vencidas (86aj9w5nt). Solo aplica con is_action=true; fecha inválida se ignora.
      let dueAt: string | null = null;
      if (isAction && typeof args.due_at === "string" && args.due_at.trim()) {
        const parsed = normalizeDatetime(args.due_at.trim());
        if (parsed) dueAt = parsed.toISOString();
      }
      const { data, error } = await supabase
        .from("client_notes")
        .insert({ client_id: clientId, user_id: userId, content, is_action: isAction, is_done: false, due_at: dueAt })
        .select("id, content, is_action, is_done, due_at, created_at")
        .single();
      if (error) return JSON.stringify({ error: safeDbError(error) });
      return JSON.stringify({ success: true, note: data, message: isAction ? `Tarea pendiente creada: "${content}"${dueAt ? ` (vence ${dueAt.slice(0, 10)})` : ""}` : `Nota guardada: "${content}"` });
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
