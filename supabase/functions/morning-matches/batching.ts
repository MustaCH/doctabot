// Lógica pura del batching y la observabilidad de morning-matches, extraída para unit-testearla
// sin levantar el handler ni mockear Supabase. La consume index.ts. Ver ticket 86aj1pgvb.

/**
 * Presupuesto de trabajo (pares a evaluar) por invocación del worker. El matching es
 * O(props × clientes) y synchronous (CPU-bound); con esto acotamos cada invocación bien por
 * debajo del worker limit (546) sin importar cuántos clientes tenga un usuario (hay usuarios
 * con miles). Cada worker procesa un slice y se auto-encadena (selfInvoke). 40k pares ≈ <0.3s CPU.
 */
export const WORK_BUDGET = 40000;

/** Cuántos elementos del loop EXTERNO procesar por invocación, dado el tamaño del loop interno.
 *  buyer phase: outer = clientes, inner = props  → sliceSize(props.length).
 *  seller phase: outer = sellers, inner = buyers → sliceSize(buyers.length).
 *  Siempre ≥ 1 (un solo elemento externo se procesa entero aunque exceda el budget: es la unidad
 *  mínima indivisible; con props/buyers acotados eso sigue siendo seguro). */
export function sliceSize(innerCount: number): number {
  return Math.max(1, Math.floor(WORK_BUDGET / Math.max(1, innerCount)));
}

/** Una llamada es "orchestrator" (arranque de corrida: cron o manual) cuando NO trae batchTimestamp.
 *  El batchTimestamp solo lo ponen los self-invokes de los workers. Así cualquier llamada externa
 *  arranca una corrida nueva sin depender del body exacto que mande el cron. */
export function isOrchestratorCall(body: unknown): boolean {
  return !(body && typeof body === "object" && typeof (body as { batchTimestamp?: unknown }).batchTimestamp === "string");
}

export type Phase = "buyer" | "seller";
export interface Cursor { userIdx: number; phase: Phase; offset: number; }
export type NextCursor =
  | { done: true; userDone: boolean }
  | { done: false; userDone: boolean; userIdx: number; phase: Phase; offset: number };

/**
 * Avanza el cursor del worker tras procesar un slice. Puro y testeable.
 * - Si quedan elementos en el loop externo de la fase actual → mismo user/fase, offset += processed.
 * - Si se agotó la fase 'buyer' → pasa a 'seller' (offset 0) del mismo user.
 * - Si se agotó la fase 'seller' → el user terminó (userDone): pasa al siguiente user en 'buyer',
 *   o done=true si no hay más users.
 *
 * @param processed cuántos elementos del loop externo se procesaron en este slice
 * @param outerTotal total del loop externo de la fase actual (clientes para buyer, sellers para seller)
 * @param usersTotal cantidad de usuarios de la corrida
 */
export function nextCursor(
  cursor: Cursor,
  processed: number,
  outerTotal: number,
  usersTotal: number,
): NextCursor {
  const nextOffset = cursor.offset + processed;
  if (nextOffset < outerTotal) {
    return { done: false, userDone: false, userIdx: cursor.userIdx, phase: cursor.phase, offset: nextOffset };
  }
  if (cursor.phase === "buyer") {
    return { done: false, userDone: false, userIdx: cursor.userIdx, phase: "seller", offset: 0 };
  }
  // seller agotado → el usuario terminó
  const nextUserIdx = cursor.userIdx + 1;
  if (nextUserIdx >= usersTotal) return { done: true, userDone: true };
  return { done: false, userDone: true, userIdx: nextUserIdx, phase: "buyer", offset: 0 };
}

/** Status final de la corrida a partir de lo acumulado. Puro.
 *  - sin usuarios procesados: 'error' si había usuarios para procesar (algo cortó antes), 'success' si no había ninguno.
 *  - todos los procesados fallaron: 'error'.
 *  - algunos fallaron: 'partial'.
 *  - ninguno falló: 'success'. */
export function computeRunStatus(
  usersProcessed: number,
  userErrors: number,
  usersTotal: number,
): "success" | "partial" | "error" {
  if (usersProcessed === 0) return usersTotal > 0 ? "error" : "success";
  if (userErrors >= usersProcessed) return "error";
  if (userErrors > 0) return "partial";
  return "success";
}
