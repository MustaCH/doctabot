// Retry con backoff exponencial para llamadas HTTP transitorias (5xx/429 o throw de red/timeout).
// Puro: recibe el thunk de fetch y un sleeper inyectable, para testearlo sin red ni timers reales.
// El retry NO re-ejecuta tools: en el tool-loop solo re-pide la generación a Gemini (los resultados
// de tools ya ejecutadas viven en `messages`). Ver 86aj1ncj4.

export interface RetryOpts {
  attempts?: number;                          // total de intentos (default 3)
  baseDelayMs?: number;                       // backoff = baseDelayMs * 2^(intento-1) (default 400)
  sleep?: (ms: number) => Promise<void>;      // inyectable para tests
  retryStatus?: (status: number) => boolean;  // default: 5xx o 429
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const defaultRetryStatus = (s: number) => s >= 500 || s === 429;

export async function fetchWithRetry(
  doFetch: () => Promise<Response>,
  opts: RetryOpts = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 400;
  const sleep = opts.sleep ?? defaultSleep;
  const retryStatus = opts.retryStatus ?? defaultRetryStatus;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await doFetch();
      // Solo reintentamos transitorios (5xx/429); 2xx y 4xx no-transitorios (402, etc.) se devuelven
      // tal cual. En el último intento devolvemos lo que haya (el caller maneja !ok).
      if (attempt < attempts && retryStatus(res.status)) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return res;
    } catch (err) {
      // Throw de red / timeout: reintentamos; en el último intento, propagamos.
      if (attempt >= attempts) throw err;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  // Inalcanzable: el loop siempre retorna o lanza en el último intento.
  throw new Error("fetchWithRetry: intentos agotados");
}
