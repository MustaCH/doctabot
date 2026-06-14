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
