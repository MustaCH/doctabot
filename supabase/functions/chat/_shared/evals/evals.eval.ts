// Entry del harness de evals (ticket 86aj9w5mg). Corre SOLO vía `npm run test:evals`
// (config vitest.evals.config.ts, include *.eval.ts): pega a la API real de Gemini.
//
// Variables de entorno:
//   GEMINI_API_KEY       (obligatoria — sin key, la suite se salta con aviso)
//   EVAL_RUNS            repeticiones por caso (default 1)
//   EVAL_MIN_PASS_RATE   umbral global que gatea CI (default 0.85)
//   EVAL_CASE_MIN_RATE   umbral por-caso para fallar el test individual (default 0.5;
//                        con EVAL_RUNS=1 un caso fallido falla su test — visibilidad local)
//   EVAL_STRICT=1        cada caso exige pass-rate 1.0 (debug)
//   EVAL_FILTER          substring/tag para correr un subconjunto (ej. EVAL_FILTER=email)
//   EVAL_CONCURRENCY     turnos en paralelo (default 4)
import { describe, it, expect, beforeAll } from "vitest";
import goldenSet from "./golden-set.json";
import { runAll, type EvalCase, type EvalRunResult } from "./runner";

const apiKey = process.env.GEMINI_API_KEY ?? "";
const RUNS = Math.max(1, Number(process.env.EVAL_RUNS ?? 1));
const MIN_PASS_RATE = Number(process.env.EVAL_MIN_PASS_RATE ?? 0.85);
const CASE_MIN_RATE = process.env.EVAL_STRICT === "1" ? 1 : Number(process.env.EVAL_CASE_MIN_RATE ?? 0.5);
const FILTER = (process.env.EVAL_FILTER ?? "").toLowerCase();
const CONCURRENCY = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 4));

const allCases = (goldenSet as { cases: EvalCase[] }).cases;
const cases = FILTER
  ? allCases.filter((c) => c.id.toLowerCase().includes(FILTER) || (c.tags ?? []).some((t) => t.toLowerCase().includes(FILTER)))
  : allCases;

const results = new Map<string, EvalRunResult[]>();

describe.skipIf(!apiKey)("Golden set de Alan (turnos reales contra API, DB mockeada)", () => {
  beforeAll(async () => {
    let done = 0;
    const total = cases.length * RUNS;
    const collected = await runAll(cases, {
      apiKey,
      runsPerCase: RUNS,
      concurrency: CONCURRENCY,
      onResult: (r) => {
        done += 1;
        const mark = r.pass ? "✓" : "✗";
        // eslint-disable-next-line no-console
        console.log(`[evals ${done}/${total}] ${mark} ${r.caseId}${r.pass ? "" : ` → ${r.failures.join(" | ")}`}`);
      },
    });
    for (const [id, rs] of collected) results.set(id, rs);
  });

  for (const c of cases) {
    const label = c.known_issue ? `${c.id} — ${c.name} [KNOWN ISSUE]` : `${c.id} — ${c.name}`;
    it(label, () => {
      const rs = results.get(c.id) ?? [];
      expect(rs.length, "el caso no corrió (¿beforeAll falló?)").toBeGreaterThan(0);
      const rate = rs.filter((r) => r.pass).length / rs.length;
      if (c.known_issue) {
        // xfail: no gatea CI. Si PASA, es una mejora — avisamos para endurecer el caso.
        if (rate >= CASE_MIN_RATE) {
          // eslint-disable-next-line no-console
          console.log(`🎉 [evals] known issue AHORA PASA (${rate.toFixed(2)}): ${c.id} — considerá quitarle known_issue (${c.known_issue})`);
        } else {
          // Detalle compacto para poder diagnosticar el known issue sin re-instrumentar.
          const first = rs.find((r) => !r.pass);
          // eslint-disable-next-line no-console
          console.log(`[evals] known issue sigue rojo (${rate.toFixed(2)}): ${c.id}\n  fallas: ${first?.failures.join(" | ")}\n  tools: [${first?.executedTools.join(", ")}]\n  texto: ${first?.content.slice(0, 900)}`);
        }
        return;
      }
      if (rate < CASE_MIN_RATE) {
        const detail = rs.filter((r) => !r.pass).map((r) => `- ${r.failures.join(" | ")}\n  texto: ${r.content.slice(0, 300)}`).join("\n");
        // Con UNA repetición, un caso probabilístico ~90% cae ~1-2 veces por corrida completa
        // (whack-a-mole): el gate de CI es el GLOBAL (≥ MIN_PASS_RATE); el per-case solo
        // reporta. Con RUNS>1 (o EVAL_STRICT) el per-case sí gatea con su umbral.
        if (RUNS === 1 && process.env.EVAL_STRICT !== "1") {
          // eslint-disable-next-line no-console
          console.log(`[evals] caso rojo en su única repetición (no gatea con RUNS=1): ${c.id}\n${detail}`);
        } else {
          expect.fail(`pass-rate del caso ${rate.toFixed(2)} < ${CASE_MIN_RATE}:\n${detail}`);
        }
      }
    });
  }

  it(`pass-rate global ≥ ${MIN_PASS_RATE} (gate de CI, excluye known issues)`, () => {
    const knownIds = new Set(cases.filter((c) => c.known_issue).map((c) => c.id));
    const all = [...results.entries()].filter(([id]) => !knownIds.has(id)).flatMap(([, rs]) => rs);
    // Un EVAL_FILTER que solo matchea known issues deja el set vacío: no hay nada que gatear.
    if (all.length === 0) return;
    const rate = all.filter((r) => r.pass).length / all.length;
    const failing = [...results.entries()].filter(([id, rs]) => !knownIds.has(id) && rs.some((r) => !r.pass)).map(([id]) => id);
    expect(rate, `casos con fallas: ${failing.join(", ")}`).toBeGreaterThanOrEqual(MIN_PASS_RATE);
  });
});

if (!apiKey) {
  describe("Golden set de Alan", () => {
    it("SKIPPED: falta GEMINI_API_KEY en el entorno (seteala para correr los evals)", () => {
      expect(apiKey).toBe("");
    });
  });
}
