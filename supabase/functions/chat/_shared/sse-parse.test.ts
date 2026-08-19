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

// 86aj9w5n8: usage del stream (stream_options.include_usage) para medir prompt caching.
describe("usage en el stream (86aj9w5n8)", () => {
  it("extrae usage de un chunk CON choice (estilo Gemini OpenAI-compat)", () => {
    const buf = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 17794, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 8175 } } })}\n`;
    const { deltas } = drainSSE(buf);
    expect(deltas[0].usage).toEqual({ promptTokens: 17794, cachedTokens: 8175, completionTokens: 12 });
    expect(deltas[0].finishReason).toBe("stop");
  });

  it("extrae usage de un chunk SIN choices (estilo OpenAI: chunk final solo-usage)", () => {
    const buf = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 5 } })}\n`;
    const { deltas } = drainSSE(buf);
    expect(deltas).toEqual([{ usage: { promptTokens: 100, cachedTokens: 0, completionTokens: 5 } }]);
  });

  it("sin prompt_tokens_details, cachedTokens es 0 (no undefined)", () => {
    const buf = `data: ${JSON.stringify({ choices: [{ delta: { content: "x" }, finish_reason: null }], usage: { prompt_tokens: 50, completion_tokens: 1 } })}\n`;
    const { deltas } = drainSSE(buf);
    expect(deltas[0].usage?.cachedTokens).toBe(0);
  });

  it("chunk sin usage ni choice se sigue ignorando (sin delta espurio)", () => {
    const buf = `data: ${JSON.stringify({ choices: [] })}\n`;
    const { deltas } = drainSSE(buf);
    expect(deltas).toEqual([]);
  });
});
