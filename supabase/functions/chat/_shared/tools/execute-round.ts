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
    const result = await executeTool(tc.name, JSON.parse(tc.arguments), toolCtx);
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
