// Config SEPARADA para los evals (ticket 86aj9w5mg): pegan a la API real de Gemini, así
// que NO corren con `npm test` (vitest.config.ts solo incluye *.test.*). Correr con:
//   npm run test:evals
// Requiere GEMINI_API_KEY en el entorno. Ver evals.eval.ts para el resto de las env vars.
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["supabase/functions/chat/_shared/evals/**/*.eval.ts"],
    testTimeout: 300_000,
    hookTimeout: 1_800_000, // beforeAll corre TODO el golden set contra la API real
    // Un solo file: la concurrencia real la maneja el pool del runner (EVAL_CONCURRENCY).
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
