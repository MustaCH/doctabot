import { describe, it, expect, vi } from "vitest";
import { executeToolCalls } from "./execute-round";

describe("executeToolCalls", () => {
  it("ejecuta cada tool y devuelve tool messages + nombres", async () => {
    const executeTool = vi.fn(async (name: string) => JSON.stringify({ success: true, name }));
    const calls = [
      { id: "c1", name: "search_properties", arguments: '{"zone":"centro"}' },
      { id: "c2", name: "create_client", arguments: '{"full_name":"Ana"}' },
    ];
    const { toolMessages, executed } = await executeToolCalls(calls, { executeTool, toolCtx: { u: 1 } });

    expect(executeTool).toHaveBeenNthCalledWith(1, "search_properties", { zone: "centro" }, { u: 1 });
    expect(executeTool).toHaveBeenNthCalledWith(2, "create_client", { full_name: "Ana" }, { u: 1 });
    expect(toolMessages).toEqual([
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ success: true, name: "search_properties" }) },
      { role: "tool", tool_call_id: "c2", content: JSON.stringify({ success: true, name: "create_client" }) },
    ]);
    expect(executed).toEqual(["search_properties", "create_client"]);
  });

  it("no cuenta como ejecutada una tool que devolvió error", async () => {
    const executeTool = vi.fn(async () => JSON.stringify({ error: "fallo" }));
    const { executed } = await executeToolCalls([{ id: "c1", name: "send_email", arguments: "{}" }], { executeTool, toolCtx: {} });
    expect(executed).toEqual([]);
  });

  it("cuenta como ejecutada si el resultado no es JSON parseable", async () => {
    const executeTool = vi.fn(async () => "texto plano");
    const { executed } = await executeToolCalls([{ id: "c1", name: "generate_report", arguments: "{}" }], { executeTool, toolCtx: {} });
    expect(executed).toEqual(["generate_report"]);
  });
});
