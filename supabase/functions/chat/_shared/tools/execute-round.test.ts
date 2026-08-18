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

  // 86aj1ncj4: args truncados/malformados (stream cortado) no deben abortar el turno.
  it("args malformados degradan a tool-message de error y NO ejecutan la tool", async () => {
    const executeTool = vi.fn();
    const { toolMessages, executed } = await executeToolCalls(
      [{ id: "c1", name: "send_email", arguments: '{"to":"yo@mail.com","body":"a medias' }],
      { executeTool, toolCtx: {} },
    );
    expect(executeTool).not.toHaveBeenCalled();
    expect(executed).toEqual([]);
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(JSON.parse(toolMessages[0].content).error).toBeTruthy();
  });

  it("un tool con args rotos no impide ejecutar los demás de la ronda", async () => {
    const executeTool = vi.fn(async (name: string) => JSON.stringify({ success: true, name }));
    const { toolMessages, executed } = await executeToolCalls(
      [
        { id: "c1", name: "send_email", arguments: '{"body":"roto' },
        { id: "c2", name: "search_properties", arguments: '{"zone":"centro"}' },
      ],
      { executeTool, toolCtx: {} },
    );
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith("search_properties", { zone: "centro" }, {});
    expect(executed).toEqual(["search_properties"]);
    expect(toolMessages).toHaveLength(2); // error de c1 + resultado de c2
  });

  // 86aj1ncj4 #1 ampliado: un throw inesperado de la tool (ej. red en getCalendarToken/Gmail) tampoco
  // debe abortar el turno.
  it("un tool que tira (throw inesperado) degrada a tool-message de error y NO aborta", async () => {
    const executeTool = vi.fn(async () => { throw new Error("network boom"); });
    const { toolMessages, executed } = await executeToolCalls(
      [{ id: "c1", name: "send_email", arguments: '{"to":"x@y.com"}' }],
      { executeTool, toolCtx: {} },
    );
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executed).toEqual([]);
    expect(toolMessages).toHaveLength(1);
    expect(JSON.parse(toolMessages[0].content).error).toBeTruthy();
  });

  // 86aj9w5kf: idempotencia de acciones externas dentro del turno.
  describe("dedup anti doble-envío (86aj9w5kf)", () => {
    const emailCall = (id: string) => ({ id, name: "send_email", arguments: '{"to":"cliente@mail.com","subject":"Hola","body":"Cuerpo"}' });

    it("send_email duplicado en la misma ronda: ejecuta UNA vez y el segundo avisa que ya se hizo", async () => {
      const executeTool = vi.fn(async () => JSON.stringify({ success: true }));
      const { toolMessages, executed } = await executeToolCalls(
        [emailCall("c1"), emailCall("c2")],
        { executeTool, toolCtx: {} },
      );
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executed).toEqual(["send_email"]);
      expect(JSON.parse(toolMessages[1].content).error).toMatch(/ya se ejecutó/);
    });

    it("el dedup persiste entre rondas del mismo turno (mismo toolCtx)", async () => {
      const executeTool = vi.fn(async () => JSON.stringify({ success: true }));
      const toolCtx = {};
      await executeToolCalls([emailCall("c1")], { executeTool, toolCtx });
      const { executed } = await executeToolCalls([emailCall("c2")], { executeTool, toolCtx });
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executed).toEqual([]);
    });

    it("throw en tool externa: wording de estado desconocido (no 'reintentá') y bloquea el replay idéntico", async () => {
      const executeTool = vi.fn(async () => { throw new Error("network boom"); });
      const toolCtx = {};
      const { toolMessages } = await executeToolCalls([emailCall("c1")], { executeTool, toolCtx });
      const err = JSON.parse(toolMessages[0].content).error;
      expect(err).toMatch(/estado desconocido/);
      expect(err).not.toMatch(/Reintentá la acción/);

      const second = await executeToolCalls([emailCall("c2")], { executeTool, toolCtx });
      expect(executeTool).toHaveBeenCalledTimes(1); // no re-ejecuta con estado desconocido
      expect(JSON.parse(second.toolMessages[0].content).error).toMatch(/ya se ejecutó/);
    });

    it("un {error} limpio de la tool NO bloquea el reintento (el efecto no ocurrió)", async () => {
      const executeTool = vi.fn(async () => JSON.stringify({ error: "Email de destinatario inválido" }));
      const toolCtx = {};
      await executeToolCalls([emailCall("c1")], { executeTool, toolCtx });
      await executeToolCalls([emailCall("c2")], { executeTool, toolCtx });
      expect(executeTool).toHaveBeenCalledTimes(2);
    });

    it("las tools sin efecto externo no se dedupean (search_properties dos veces corre dos veces)", async () => {
      const executeTool = vi.fn(async () => JSON.stringify({ total_count: 3 }));
      const call = (id: string) => ({ id, name: "search_properties", arguments: '{"zone":"centro"}' });
      const { executed } = await executeToolCalls([call("c1"), call("c2")], { executeTool, toolCtx: {} });
      expect(executeTool).toHaveBeenCalledTimes(2);
      expect(executed).toEqual(["search_properties", "search_properties"]);
    });

    it("mismo tool externo con args DISTINTOS sí ejecuta ambos", async () => {
      const executeTool = vi.fn(async () => JSON.stringify({ success: true }));
      const { executed } = await executeToolCalls(
        [
          { id: "c1", name: "send_email", arguments: '{"to":"a@mail.com","subject":"S","body":"B"}' },
          { id: "c2", name: "send_email", arguments: '{"to":"b@mail.com","subject":"S","body":"B"}' },
        ],
        { executeTool, toolCtx: {} },
      );
      expect(executeTool).toHaveBeenCalledTimes(2);
      expect(executed).toEqual(["send_email", "send_email"]);
    });
  });
});
