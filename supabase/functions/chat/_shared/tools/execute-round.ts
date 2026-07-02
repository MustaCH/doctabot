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

export async function executeToolCalls(
  toolCalls: AccumulatedToolCall[],
  deps: ExecuteRoundDeps,
): Promise<{ toolMessages: any[]; executed: string[] }> {
  const { executeTool, toolCtx } = deps;
  const toolMessages: any[] = [];
  const executed: string[] = [];

  for (const tc of toolCalls) {
    // Degradación robusta del tool-loop (86aj1ncj4): tanto los args truncados/malformados (el stream
    // cortado deja el JSON a medias — típico con el body grande de send_email) como un throw inesperado
    // de la tool (ej. error de red en getCalendarToken o en el fetch a Gmail) se capturan acá y se
    // convierten en un tool-message de error, en vez de abortar el turno ENTERO. El modelo lo ve y
    // recupera; la tool NO se cuenta como ejecutada y el resto de la ronda sigue.
    let result: string;
    try {
      const args = tc.arguments ? JSON.parse(tc.arguments) : {};
      result = await executeTool(tc.name, args, toolCtx);
    } catch (err) {
      console.error(`Tool ${tc.name} falló:`, err);
      toolMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "No se pudo ejecutar la herramienta (parámetros incompletos o error transitorio). Reintentá la acción." }) });
      continue;
    }
    toolMessages.push({ role: "tool", tool_call_id: tc.id, content: result });
    try {
      const parsed = JSON.parse(result);
      if (parsed.success || !parsed.error) executed.push(tc.name);
    } catch {
      executed.push(tc.name);
    }
  }

  return { toolMessages, executed };
}
