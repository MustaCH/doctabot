// Ejecuta una ronda de tool_calls ya acumuladas y arma los mensajes de resultado.
// Puro (deps inyectadas) para ser testeable.

export interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
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
    // Args del tool_call: pueden venir truncados/malformados si el stream se cortó (típico con el
    // body grande de send_email). Antes, un JSON.parse sin guarda explotaba y abortaba el turno
    // ENTERO antes de ejecutar nada (86aj1ncj4: el mail no se enviaba y el usuario veía el error
    // estático). Ahora degradamos: tool-message de error para que el modelo reintente o avise; la
    // tool NO corre (no se cuenta como ejecutada) y el resto de la ronda sigue.
    let args: any;
    try {
      args = tc.arguments ? JSON.parse(tc.arguments) : {};
    } catch {
      toolMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "Los parámetros de la herramienta llegaron incompletos. Reintentá la acción." }) });
      continue;
    }
    const result = await executeTool(tc.name, args, toolCtx);
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
