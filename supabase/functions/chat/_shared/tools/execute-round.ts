// Ejecuta una ronda de tool_calls ya acumuladas y arma los mensajes de resultado.
// Puro (deps inyectadas) para ser testeable.

import { runningLabel, doneLabel, type ToolStep } from "../tool-steps.ts";

export interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
  thoughtSignature?: string; // Gemini 3+: se reenvía en el assistant message (ver sse-parse.ts / 86ajbjq22)
}

export interface ExecuteRoundDeps {
  executeTool: (name: string, args: any, ctx: any) => Promise<string>;
  toolCtx: any;
  // Pasos visibles del tool-loop (86ak3kd5r): "running" antes de ejecutar cada tool y "done"
  // al terminar (con label determinista de tool-steps.ts). Fail-open: si tira, no rompe la ronda.
  onStep?: (step: ToolStep) => void;
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
  const emitStep = (step: ToolStep) => {
    try { deps.onStep?.(step); } catch { /* los pasos nunca rompen la ronda */ }
  };

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
    const callKey = `${tc.name}:${JSON.stringify(args)}`;
    const dedupKey = isExternal ? callKey : null;
    if (seen && dedupKey && seen.has(dedupKey)) {
      toolMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: "Esta acción externa ya se ejecutó en este mismo turno con los mismos datos: NO se repitió (anti doble-envío). Avisale al agente que ya está hecha; si de verdad hay que repetirla, que la pida de nuevo." }) });
      continue;
    }

    // Corte de reintento idéntico tras error (86ak2tkjg): si ESTA misma tool con ESTOS mismos
    // args ya devolvió un {error} limpio en el MISMO turno, el error es determinista (con args
    // idénticos, reintentar no cambia nada — ej. Calendar desconectado) y re-ejecutarla solo
    // quema iteraciones del tool-loop. Se devuelve un resultado sintético que corta el loop.
    // Conservador: solo aplica a resultados de ERROR — nunca a tools que devolvieron datos —
    // y solo a args IDÉNTICOS (un reintento con args corregidos sí se ejecuta). El Map vive en
    // toolCtx (per-turno), igual que el dedup externo.
    const prevError = (toolCtx.failedCallErrors as Map<string, string> | undefined)?.get(callKey);
    if (prevError !== undefined) {
      toolMessages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ error: `Esta herramienta ya falló con el mismo error en este mismo turno: NO la reintentes con los mismos datos (el error es permanente dentro del turno). Explicale el problema al agente u ofrecé una alternativa. Error original: ${prevError}` }) });
      continue;
    }

    // Un throw inesperado de la tool (ej. error de red en getCalendarToken o en el fetch a
    // Gmail) también degrada a tool-message de error; el modelo lo ve y recupera. Para tools
    // externas el estado es DESCONOCIDO (el efecto pudo haberse aplicado igual): el wording no
    // induce reenvío y el hash se marca para bloquear un replay idéntico en el mismo turno.
    emitStep({ tool: tc.name, label: runningLabel(tc.name), status: "running" });
    let result: string;
    try {
      result = await executeTool(tc.name, args, toolCtx);
    } catch (err) {
      console.error(`Tool ${tc.name} falló:`, err);
      emitStep({ tool: tc.name, label: "Un paso no salió, probando otra cosa", status: "done" });
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
        emitStep({ tool: tc.name, label: doneLabel(tc.name, result), status: "done" });
        if (seen && dedupKey) seen.add(dedupKey);
      } else {
        emitStep({ tool: tc.name, label: "Un paso no salió, probando otra cosa", status: "done" });
        // Resultado con {error} limpio: la tool NO ejecutó el efecto (sin hash externo), pero el
        // error queda memorizado para cortar un reintento IDÉNTICO en el mismo turno (86ak2tkjg).
        // Un reintento con args distintos no se ve afectado. El Map se crea lazy en toolCtx
        // (per-turno) para no mutar el ctx en turnos sin errores.
        (toolCtx.failedCallErrors ??= new Map<string, string>()).set(callKey, String(parsed.error).slice(0, 300));
      }
    } catch {
      executed.push(tc.name);
      emitStep({ tool: tc.name, label: doneLabel(tc.name), status: "done" });
      if (seen && dedupKey) seen.add(dedupKey);
    }
  }

  return { toolMessages, executed };
}
