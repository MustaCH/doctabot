// Cálculo puro del avgScore del supervisor (ticket 86aj9w5kq).
// Extraído de index.ts para poder testearlo con Vitest (index.ts tiene imports URL de Deno).
//
// Los rechazos deterministas de supervisor-rules tienen score fijo 2-3 y contaminaban el
// promedio de scores LLM 1-10. Se detectan por el prefijo "[determinista]" (logs nuevos,
// lo agrega supervisor.ts al loguear) o por los templates legacy (logs anteriores).
export const DETERMINISTIC_REASON = /^\[determinista\]|guardado fantasma|en vez de actuada|applied_filters|only_active/;

export interface ScoreRow {
  score: number | null;
  rejection_reason: string | null;
}

export function computeScoreStats(rows: ScoreRow[]): {
  avgScore: number;
  sampleSize: number;
  deterministicRejected: number;
} {
  const valid = rows.filter((r) => typeof r.score === "number" && (r.score as number) > 0);
  const llm = valid.filter((r) => !DETERMINISTIC_REASON.test(r.rejection_reason ?? ""));
  const avg = llm.length > 0 ? llm.reduce((a, r) => a + (r.score as number), 0) / llm.length : 0;
  return {
    avgScore: Math.round(avg * 10) / 10,
    sampleSize: llm.length,
    deterministicRejected: valid.length - llm.length,
  };
}
