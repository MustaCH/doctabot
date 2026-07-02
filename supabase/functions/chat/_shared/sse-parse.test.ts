import { describe, it, expect } from "vitest";
import { drainSSE } from "./sse-parse";

describe("drainSSE", () => {
  it("extrae un content delta", () => {
    const buf = `data: ${JSON.stringify({ choices: [{ delta: { content: "Hola" }, finish_reason: null }] })}\n`;
    const { deltas, rest, done } = drainSSE(buf);
    expect(deltas).toEqual([{ contentDelta: "Hola", finishReason: null }]);
    expect(rest).toBe("");
    expect(done).toBe(false);
  });

  it("marca done con [DONE]", () => {
    const { done } = drainSSE("data: [DONE]\n");
    expect(done).toBe(true);
  });

  it("ignora comentarios y líneas vacías", () => {
    const { deltas } = drainSSE(": keep-alive\n\n");
    expect(deltas).toEqual([]);
  });

  it("acumula tool_call fragments con index", () => {
    const buf = `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "send_email", arguments: '{"to":' } }] }, finish_reason: null }] })}\n`;
    const { deltas } = drainSSE(buf);
    expect(deltas[0].toolCallDeltas).toEqual([{ index: 0, id: "c1", name: "send_email", argsFragment: '{"to":' }]);
  });

  it("extrae el thought_signature de un tool_call (Gemini 3, 86ajbjq22)", () => {
    const buf = `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "buscar", arguments: "{}" }, extra_content: { google: { thought_signature: "SIG123" } } }] }, finish_reason: null }] })}\n`;
    const { deltas } = drainSSE(buf);
    expect(deltas[0].toolCallDeltas?.[0].thoughtSignature).toBe("SIG123");
  });

  it("devuelve en rest una línea con JSON partido entre chunks", () => {
    const partial = `data: {"choices":[{"delta":{"content":"ho`;
    const { deltas, rest } = drainSSE(partial + "\n");
    expect(deltas).toEqual([]);
    expect(rest.startsWith("data: {")).toBe(true);
  });

  it("captura finish_reason", () => {
    const buf = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n`;
    const { deltas } = drainSSE(buf);
    expect(deltas[0].finishReason).toBe("tool_calls");
  });
});
