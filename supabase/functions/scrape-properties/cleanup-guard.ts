// Guardarraíl del cleanup del scraper (delete de propiedades no vistas en la corrida).
//
// Riesgo que cierra: runCleanup borra TODO lo que tenga last_seen_at < batchTimestamp. Si la
// corrida fue incompleta (páginas perdidas por errores, scraper del VPS degradado), esas filas
// no son bajas reales sino páginas que no se visitaron — y el delete vaciaba media tabla.
// Este módulo decide si ABORTAR el cleanup. Puro y testeable con Vitest (sin deps de Deno).

/** % máximo de la tabla que el cleanup puede borrar en una corrida. Configurable vía el
 *  parámetro maxRatio (index.ts puede pisarlo con la env CLEANUP_MAX_DELETE_RATIO). */
export const CLEANUP_MAX_DELETE_RATIO = 0.30;

/** % máximo de páginas con error tolerado antes de abortar el cleanup (m4): un error binario
 *  hacía que UNA página perdida en 500 abortara la limpieza todos los días y las bajas reales
 *  nunca se borraran. Hasta 5% de páginas perdidas la corrida sigue siendo representativa. */
export const CLEANUP_MAX_PAGE_ERROR_RATIO = 0.05;

/**
 * Decide si el cleanup debe abortarse:
 *  - Errores de página por encima del 5% del total de páginas (m4) → abortar (lo "obsoleto" puede
 *    ser una página perdida). Si no se conoce totalPages, se mantiene el criterio binario
 *    (cualquier error aborta): sin denominador no se puede razonar el porcentaje.
 *  - El % de filas a borrar supera maxRatio (default 30%) → abortar (corrida sospechosamente corta).
 * Sin filas a borrar nunca aborta (no hay nada que proteger).
 */
export function shouldAbortCleanup(params: {
  pageErrors: number;
  staleCount: number;
  totalCount: number;
  totalPages?: number;
  maxRatio?: number;
  maxPageErrorRatio?: number;
}): { abort: boolean; reason: string | null } {
  const { pageErrors, staleCount, totalCount } = params;
  const maxRatio = params.maxRatio ?? CLEANUP_MAX_DELETE_RATIO;
  const maxPageErrorRatio = params.maxPageErrorRatio ?? CLEANUP_MAX_PAGE_ERROR_RATIO;
  const totalPages = params.totalPages ?? 0;
  if (staleCount <= 0) return { abort: false, reason: null };
  if (pageErrors > 0) {
    if (totalPages > 0) {
      const errRatio = pageErrors / totalPages;
      if (errRatio > maxPageErrorRatio) {
        return {
          abort: true,
          reason: `la corrida perdió ${pageErrors} de ${totalPages} páginas (${Math.round(errRatio * 100)}% > ${Math.round(maxPageErrorRatio * 100)}% tolerado): las propiedades "obsoletas" pueden ser páginas perdidas, no bajas reales`,
        };
      }
      // ≤5% de páginas perdidas: la corrida sigue siendo representativa, el cleanup procede.
    } else {
      return {
        abort: true,
        reason: `la corrida tuvo ${pageErrors} error(es) de página y no se conoce el total de páginas: las propiedades "obsoletas" pueden ser páginas perdidas, no bajas reales`,
      };
    }
  }
  if (totalCount > 0 && staleCount / totalCount > maxRatio) {
    const pct = Math.round((staleCount / totalCount) * 100);
    return {
      abort: true,
      reason: `borraría ${staleCount} de ${totalCount} filas (${pct}% > ${Math.round(maxRatio * 100)}% permitido): probable corrida incompleta`,
    };
  }
  return { abort: false, reason: null };
}
