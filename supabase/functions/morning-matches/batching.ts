// Lógica pura del batching y la observabilidad de morning-matches, extraída para unit-testearla
// sin levantar el handler ni mockear Supabase. La consume index.ts. Ver ticket 86aj1pgvb.

/** Tamaño de lote de usuarios por invocación. Conservador: cada worker procesa pocos usuarios
 *  y se auto-encadena al siguiente lote, así ninguna invocación se acerca al worker limit (546).
 *  Subir con cuidado (medir tiempo/heap por corrida antes). */
export const USERS_PER_INVOCATION = 8;

/** Una llamada es "orchestrator" (arranque de corrida: cron o manual) cuando NO trae batchTimestamp.
 *  El batchTimestamp solo lo ponen los self-invokes de los workers. Así cualquier llamada externa
 *  arranca una corrida nueva sin depender del body exacto que mande el cron. */
export function isOrchestratorCall(body: unknown): boolean {
  return !(body && typeof body === "object" && typeof (body as { batchTimestamp?: unknown }).batchTimestamp === "string");
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
