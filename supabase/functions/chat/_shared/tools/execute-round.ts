// Ejecuta una ronda de tool_calls ya acumuladas y arma los mensajes de resultado.
// Puro (deps inyectadas) para ser testeable.

export interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
  thoughtSignature?: string; // Gemini 3+: se reenvía en el assistant message (ver sse-parse.ts / 86ajbjq22)
}

export interface ExecuteRoundDeps {
  executeTool: (name: string, args: any, ctx: any) => Promise<string>;
  toolCtx: any;
}

// Tools con efecto externo real (un duplicado le llega a un cliente de verdad).
// Para estas: (a) el wording de error nunca induce reenvío a ciegas, y (b) se dedupea
// por name+args dentro del turno — si el modelo la re-emite idéntica, no se re-ejecuta.
// Ticket 86aj9w5kf; el riesgo cross-turn quedó documentado en stream-turn.test.ts.
const EXTERNAL_EFFECT_TOOLS = new Set(["send_email", "create_calendar_event", "create_meet_event"]);

export async function executeToolCalls(
  toolCalls: AccumulatedToolCall[],
  deps: ExecuteRoundDeps,
): Promise<{ toolMessages: any[]; executed: string[] }> {
  const { executeTool, toolCtx } = deps;
  const toolMessages: any[] = [];
  const executed: string[] = [];

  for (const tc of toolCalls) {
    const isExternal = EXTERNAL_EFFECT_TOOLS.has(tc.name);

    // Degradación robusta del tool-loop (86aj1ncj4): args truncados/malformados (el stream
    // cortado deja el JSON a medias — típico con el body grande de send_email) degradan a un
    // tool-message de error en vez de abortar el turno ENTERO. Acá la tool NUNCA corrió, así
    // que "reintentá" es seguro incluso para tools externas.
    let args: any;
    try {
      args = tc.arguments ? JSON.parse(tc.arguments) : {};
    } catch (err) {
      console.error(`Tool ${tc.name} args malformados:`, err);
      toolMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "No se pudo ejecutar la herramienta (parámetros incompletos o malformados). Reintentá la acción." }) });
      continue;
    }

    // Dedup anti doble-envío dentro del turno (86aj9w5kf): mismo name+args ya ejecutado (o en
    // estado desconocido tras un throw) → NO se re-ejecuta. El Set vive en toolCtx (per-turno).
    const seen: Set<string> | null = isExternal ? (toolCtx.externalEffectHashes ??= new Set<string>()) : null;
    const dedupKey = isExternal ? `${tc.name}:${JSON.stringify(args)}` : null;
    if (seen && dedupKey && seen.has(dedupKey)) {
      toolMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "Esta acción externa ya se ejecutó en este mismo turno con los mismos datos: NO se repitió (anti doble-envío). Avisale al agente que ya está hecha; si de verdad hay que repetirla, que la pida de nuevo." }) });
      continue;
    }

    // Un throw inesperado de la tool (ej. error de red en getCalendarToken o en el fetch a
    // Gmail) también degrada a tool-message de error; el modelo lo ve y recupera. Para tools
    // externas el estado es DESCONOCIDO (el efecto pudo haberse aplicado igual): el wording no
    // induce reenvío y el hash se marca para bloquear un replay idéntico en el mismo turno.
    let result: string;
    try {
      result = await executeTool(tc.name, args, toolCtx);
    } catch (err) {
      console.error(`Tool ${tc.name} falló:`, err);
      if (seen && dedupKey) seen.add(dedupKey);
      const msg = isExternal
        ? "No se pudo confirmar la acción externa (email/evento): estado desconocido — pudo haberse ejecutado igual. NO la reintentes automáticamente; verificá con el agente antes de reenviar."
        : "No se pudo ejecutar la herramienta (parámetros incompletos o error transitorio). Reintentá la acción.";
      toolMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: msg }) });
      continue;
    }
    toolMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
    try {
      const parsed = JSON.parse(result);
      if (parsed.success || !parsed.error) {
        executed.push(tc.name);
        if (seen && dedupKey) seen.add(dedupKey);
      }
      // Resultado con {error} limpio: la tool NO ejecutó el efecto → reintentar es válido, sin hash.
    } catch {
      executed.push(tc.name);
      if (seen && dedupKey) seen.add(dedupKey);
    }
  }

  return { toolMessages, executed };
}
