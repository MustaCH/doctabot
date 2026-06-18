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
    test: /\b(list|mostr|busc|ver|cu[aá]nt|cu[aá]l)[^.?!\n]{0,30}\bclientes?\b/i,
    tools: ["list_clients", "get_client"],
    label: "list_clients",
  },
  {
    test: /\b(busc|encontr|mostr|ver|hay|cu[aá]nt|cu[aá]l)[^.?!\n]{0,40}\b(propiedad|propiedades|deptos?|departamentos?|casas?|ph|lotes?|terrenos?|oficinas?|locales?|cocheras?)\b/i,
    tools: ["search_properties", "search_external_portals"],
    label: "search_properties",
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
