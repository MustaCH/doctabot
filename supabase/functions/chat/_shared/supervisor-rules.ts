// Reglas deterministas del supervisor — SIN imports de runtime (Deno URL) para poder
// unit-testearlas con Vitest. Las consume supervisor.ts. Ver ticket 86aj1f0x3.

/**
 * Intenciones CLARAS de lectura de datos y las tools que las satisfacen. Espejo del
 * bloque "USO OBLIGATORIO DE HERRAMIENTAS" del system prompt: si el agente pide listar/
 * buscar/ver datos y NINGUNA de las tools correspondientes corrió en el turno, Alan
 * inventó o describió en vez de actuar.
 */
export const READ_INTENTS: Array<{ test: RegExp; tools: string[]; label: string }> = [
  // Nota: usamos stems de verbo (list/mostr/busc…) y NO ponemos \b inmediatamente después,
  // porque \b no matchea tras una vocal acentuada ("buscá", "mostrá"): á no es \w.
  {
    // Gap "templado": si entre el verbo y "clientes" aparece eventos/cumpleaños/propiedades,
    // el pedido es sobre ESO del cliente (intents de abajo), no sobre listar clientes —
    // "mostrame los eventos de mis clientes" no debe exigir list_clients (86aj9w5mq).
    // El stem "list" excluye el adjetivo "listo/listos" (baseline de evals: "pasámelo
    // listo para mandarle a un cliente" era un falso rechazo); "lista/listame/listá" siguen.
    test: /\b(list(?!os?\b)|mostr|busc|ver|cu[aá]nt|cu[aá]l)(?:(?!\b(?:eventos?|cumplea[ñn]os|aniversarios?|propiedades)\b)[^.?!\n]){0,30}\bclientes?\b/i,
    tools: ["list_clients", "get_client"],
    label: "list_clients",
  },
  {
    test: /\b(busc|encontr|mostr|ver|hay|cu[aá]nt|cu[aá]l)[^.?!\n]{0,40}\b(propiedad|propiedades|deptos?|departamentos?|casas?|ph|lotes?|terrenos?|oficinas?|locales?|cocheras?)\b/i,
    // list_client_properties también satisface este intent: "mostrame las propiedades de Ana"
    // se responde bien con las guardadas del cliente, no solo con una búsqueda (86aj9w5mq).
    tools: ["search_properties", "search_external_portals", "list_client_properties"],
    label: "search_properties",
  },
  // Propiedades GUARDADAS/vinculadas de un cliente (86aj9w5mq). Frases con "propiedades" +
  // verbo también caen en el intent anterior (que ya acepta list_client_properties); este
  // patrón cubre además las formas "qué propiedades le mandé/envié a X".
  {
    test: /\b(ver|mostr|list|cu[aá]l|qu[eé])[^.?!\n]{0,40}\bpropiedades (guardadas|vinculadas|enviadas|sugeridas)\b|\bqu[eé] propiedades le (mand|envi|mostr|guard|suger)/i,
    tools: ["list_client_properties"],
    label: "list_client_properties",
  },
  // Eventos/cumpleaños de clientes (86aj9w5mq). "cumpleaños/aniversario" solo existe en
  // client_events; "eventos ... cliente" evita chocar con el intent de agenda propia
  // ("mis eventos"), que exige el posesivo.
  {
    test: /\b(ver|mostr|list|record|cu[aá]l|qu[eé]|cu[aá]ndo)[^.?!\n]{0,30}\b(cumplea[ñn]os|aniversarios?)\b|\b(ver|mostr|list|cu[aá]l|qu[eé])[^.?!\n]{0,25}\beventos\b[^.?!\n]{0,30}\bclientes?\b/i,
    tools: ["list_client_events"],
    label: "list_client_events",
  },
  {
    test: /\b(ver|mostr|list|cu[aá]l)[^.?!\n]{0,20}\bfavoritos?\b/i,
    tools: ["get_favorites"],
    label: "get_favorites",
  },
  {
    test: /\b(mi agenda|qu[eé] tengo (hoy|ma[ñn]ana|esta semana|este)|mis (pr[oó]ximas? )?(visitas|eventos|reuniones)|pr[oó]xim[oa]s (visitas|eventos|reuniones))\b/i,
    tools: ["list_calendar_events"],
    label: "list_calendar_events",
  },
];

/**
 * Si el mensaje del usuario es un pedido claro de lectura y la tool correspondiente NO
 * está en executedTools, devuelve un verdict `rejected` determinista (no necesita LLM).
 * Si no aplica, devuelve null y el supervisor sigue con la eval normal del modelo.
 */
export function unactedReadVerdict(
  userMessage: string,
  executedTools: string[],
): { verdict: "rejected"; score: number; reason: string; category: string } | null {
  const msg = userMessage || "";
  const tools = executedTools || [];
  for (const intent of READ_INTENTS) {
    if (intent.test.test(msg) && !intent.tools.some((t) => tools.includes(t))) {
      return {
        verdict: "rejected",
        score: 2,
        reason: `Pedido de lectura de datos sin ejecutar la tool correspondiente (${intent.label}): respuesta inventada o descripta en vez de actuada.`,
        category: "accion_no_ejecutada",
      };
    }
  }
  return null;
}

/**
 * Afirmaciones de ESCRITURA en la RESPUESTA de Alan y las tools que las cumplen. Análogo a
 * READ_INTENTS pero del lado del output: si Alan dice que guardó/vinculó/agendó/envió/creó algo y
 * NINGUNA de las tools correspondientes corrió, es un "guardado fantasma" (tool emitida como texto
 * o alucinada). Anclado en el pretérito 1ª persona ACENTUADO ("guardé", "vinculé") a propósito: así
 * NO marca ofertas/subjuntivos ("¿querés que guarde…?"). Precisión > recall (el supervisor solo
 * loguea; un falso positivo ensucia métricas). Ver 86aj1nb16.
 */
export const WRITE_CLAIMS: Array<{ test: RegExp; tools: string[]; label: string }> = [
  { test: /\b(guardé|adjunté|agregué|sumé)[^.?!\n]{0,40}\b(propiedad|al perfil|a su perfil|al cliente)\b/i, tools: ["save_property_to_client"], label: "save_property_to_client" },
  // Claim engañoso (86aj42cb2): Alan dice que una BÚSQUEDA/propiedades "quedaron registradas/guardadas
  // al perfil" pero solo corrió link_conversation (que vincula la CONVERSACIÓN, no guarda propiedades).
  // El claim de link_conversation es literalmente cierto pero el agente entiende que las propiedades
  // quedaron en el perfil — y no quedó ninguna. Exige save_property_to_client. La condición de objeto
  // (búsqueda/opciones/propiedad/tarjetas) lo separa del claim honesto "vinculé la conversación".
  // Verbos en pretérito 1ª persona ACENTUADO (vinculé, registré…) a propósito: NO marca subjuntivos/
  // ofertas ("¿querés que guarde…?"). Mismo criterio de precisión que los demás WRITE_CLAIMS.
  { test: /\b(vinculé|registré|guardé|sumé|asocié|anoté)[^.?!\n]{0,40}\b(b[uú]squeda|opciones|propiedad(?:es)?|tarjetas?)\b[^.?!\n]{0,40}\bperfil\b/i, tools: ["save_property_to_client"], label: "save_property_to_client (propiedades/búsqueda al perfil)" },
  { test: /\b(vinculé|asocié)[^.?!\n]{0,40}\b(conversaci|cliente|perfil)/i, tools: ["link_conversation"], label: "link_conversation" },
  { test: /\b(agendé|programé|reservé)[^.?!\n]{0,40}\b(visita|reuni[oó]n|evento|llamada|cita)\b/i, tools: ["create_calendar_event", "create_meet_event", "create_client_event"], label: "evento" },
  { test: /\b(envié|mandé)[^.?!\n]{0,30}\b(email|mail|correo)\b/i, tools: ["send_email"], label: "send_email" },
  { test: /\b(creé|registré)[^.?!\n]{0,30}\b(cliente|contacto)\b/i, tools: ["create_client"], label: "create_client" },
  // Borrado fantasma: Alan dice que borró/eliminó un cliente/contacto pero no corrió ninguna
  // tool de borrado. Pretérito 1ª persona acentuado (borré/eliminé) → no marca ofertas ("¿lo borro?").
  { test: /\b(borré|eliminé)[^.?!\n]{0,40}\b(cliente|contacto|clientes|contactos)\b/i, tools: ["delete_client", "delete_all_clients"], label: "delete_client/delete_all_clients" },
  // Update fantasma (86aj9w5mq): "le cambié el estado a hot" / "actualicé su presupuesto" sin
  // update_client. Mismo anclaje en pretérito 1ª persona acentuado (no marca "¿le cambio el
  // estado?"); "marqué como hot/frío" va aparte para no confundir con mark_contacted.
  { test: /\b(cambié|actualicé|modifiqué)[^.?!\n]{0,40}\b(estado|status|perfil|presupuesto|datos|zonas?|tel[eé]fono|email)\b/i, tools: ["update_client"], label: "update_client" },
  { test: /\bmarqué[^.?!\n]{0,30}\bcomo (hot|warm|cold|caliente|fr[ií]o|tibi[oa])\b/i, tools: ["update_client"], label: "update_client (status)" },
];

/**
 * Si la respuesta de Alan afirma una acción de escritura y la tool correspondiente NO está en
 * executedTools, devuelve un verdict `rejected` determinista (no necesita LLM). Detección post-hoc
 * (el supervisor solo loguea): hace visible el guardado fantasma en supervisor_logs. Ver 86aj1nb16.
 */
export function unexecutedWriteVerdict(
  assistantContent: string,
  executedTools: string[],
): { verdict: "rejected"; score: number; reason: string; category: string } | null {
  const txt = assistantContent || "";
  const tools = executedTools || [];
  for (const claim of WRITE_CLAIMS) {
    if (claim.test.test(txt) && !claim.tools.some((t) => tools.includes(t))) {
      return {
        verdict: "rejected",
        score: 2,
        reason: `Afirmó una acción de escritura (${claim.label}) que NO se ejecutó: posible "guardado fantasma" (tool emitida como texto o alucinada).`,
        category: "accion_no_ejecutada",
      };
    }
  }
  return null;
}

// NOTA (M2): acá vivía whatsappWithoutContactToolVerdict (rechazo determinista por bloques
// <<<WHATSAPP_TO>>> sin list_clients/get_client en el turno). Se ELIMINÓ: el supervisor evalúa el
// texto YA saneado por sanitizeWhatsappBlocks, así que los únicos bloques que podía ver eran los
// LEGÍTIMOS (cliente sembrado / teléfono tipeado) → 100% falsos positivos + webhook n8n en cada
// WhatsApp normal. El daño real lo cubre el guardarraíl server-side, que es más fuerte (elimina
// los bloques inventados antes de que lleguen al usuario) y loguea por console.warn.

// Claims SUPERLATIVOS sobre resultados de búsqueda que NINGÚN filtro puede respaldar
// ("se ajustan perfectamente", "100% de coincidencia", "garantizadas"): la tool solo garantiza
// que los resultados matchean los filtros aplicados (applied_filters). Precisión > recall
// (mismo criterio que WRITE_CLAIMS): regexes ancladas al contexto de resultados/propiedades
// para no marcar prosa legítima. Incidente "172 que se ajustan perfectamente".
const SEARCH_SUPERLATIVE_CLAIM =
  /\b(se\s+ajustan|se\s+adaptan|encajan|coinciden|cumplen|matchean)\s+(perfectamente|al\s*100\s*%|exactamente\s+con\s+todo)|\b100\s*%\s+(de\s+)?(coincidencia|match|compatib)|\b(propiedades|resultados|opciones)\b[^.?!\n]{0,30}\bgarantizad[oa]s\b|\bmatch(es)?\s+perfectos?\b/i;

// Claims de VIGENCIA ("activas", "vigentes", "disponibles hoy") sobre los resultados: solo los
// respalda el filtro only_active de search_properties (default true; puede venir en false).
const SEARCH_ACTIVE_CLAIM =
  /\b(propiedades|publicaciones|avisos|resultados|opciones|listados?)\b[^.?!\n]{0,40}\b(activ[ao]s|vigentes|disponibles\s+hoy)\b|\b(todas?\s+)?(activ[ao]s|vigentes)\b[^.?!\n]{0,40}\b(propiedades|publicaciones|avisos|resultados|opciones)\b/i;

/**
 * Regla determinista de HONESTIDAD DE BÚSQUEDA: si la respuesta presenta resultados de
 * search_properties con claims que los filtros realmente aplicados no respaldan, se rechaza.
 *  - Superlativos ("perfectamente", "100%", "garantizadas"): ningún filtro los respalda → rejected.
 *  - Vigencia ("activas/vigentes"): respaldado SOLO si applied_filters.only_active === true.
 *    Con eco NULL la regla de vigencia NO se evalúa (m2): un eco ausente significa que la búsqueda
 *    no llegó a correr o el contexto no lo propagó — rechazar por falta de eco generaba falsos
 *    positivos (precisión > recall; el default real de la tool es only_active=true).
 * Solo aplica cuando search_properties corrió en el turno (sin búsqueda no hay claim de resultados
 * que evaluar). El supervisor solo loguea (ADR 0001): precisión > recall.
 */
export function unsupportedSearchClaimVerdict(
  assistantContent: string,
  executedTools: string[],
  appliedFilters?: Record<string, unknown> | null,
): { verdict: "rejected"; score: number; reason: string; category: string } | null {
  const txt = assistantContent || "";
  if (!txt || !(executedTools || []).includes("search_properties")) return null;
  if (SEARCH_SUPERLATIVE_CLAIM.test(txt)) {
    return {
      verdict: "rejected",
      score: 3,
      reason: "Claim superlativo sobre los resultados de búsqueda ('se ajustan perfectamente'/'100%'/'garantizadas') que ningún filtro de search_properties respalda: la tool solo garantiza coincidencia con los filtros aplicados (applied_filters).",
      category: "dato_inventado",
    };
  }
  // Precisión (hallazgo del golden set, 2026-08-19): las frases NEGADAS de vigencia ("puede que
  // ya no esté activa", "no figura vigente", "dejó de estar publicada") son honestidad, no un
  // claim — se neutralizan antes de testear para no rechazar respuestas correctas de 0-resultados.
  const withoutNegations = txt.replace(
    /\b(ya\s+)?no\s+(est[áa][ns]?|est[ée][ns]?|figura[ns]?|sigue[ns]?|aparece[ns]?|se\s+encuentra[ns]?)\s+(m[áa]s\s+)?\w{0,20}\s?(activ\w+|vigente\w*|publicad\w+|disponible\w*)/gi,
    "",
  );
  if (appliedFilters && SEARCH_ACTIVE_CLAIM.test(withoutNegations) && appliedFilters.only_active !== true) {
    return {
      verdict: "rejected",
      score: 3,
      reason: "Claim de vigencia ('activas'/'vigentes') sobre resultados de búsqueda sin respaldo del filtro only_active en applied_filters.",
      category: "dato_inventado",
    };
  }
  return null;
}

/** Categorías canónicas de los veredictos del supervisor (loop de mejora agregable).
 *  Ver ticket 86aj1f1up. */
export const SUPERVISOR_CATEGORIES = [
  "dato_inventado",
  "formato_roto",
  "accion_no_ejecutada",
  "regla_negocio",
  "seguridad",
  "crm_protocol",
  "tono",
] as const;

/**
 * Bloque "CONTEXTO PREVIO" que el supervisor antepone para no evaluar follow-ups
 * ("sí, dale", "mandáselo") en aislamiento. Devuelve "" si no hay contexto previo.
 * Puro y testeable. Ver ticket 86aj1f1up.
 */
export function buildPriorContextBlock(
  prior: { user?: string | null; assistant?: string | null } | null | undefined,
): string {
  if (!prior) return "";
  const u = (prior.user ?? "").trim();
  const a = (prior.assistant ?? "").trim();
  if (!u && !a) return "";
  const parts: string[] = ["CONTEXTO PREVIO (turno anterior, para interpretar follow-ups):"];
  if (u) parts.push(`Usuario (anterior): ${u.slice(0, 800)}`);
  if (a) parts.push(`Alan (anterior): ${a.slice(0, 800)}`);
  return parts.join("\n");
}
