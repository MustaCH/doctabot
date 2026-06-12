// Validation helpers and constants used across tool execution

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const VALID_CLIENT_STATUSES = ["hot", "warm", "cold"];
export const VALID_CLIENT_TYPES = ["buyer", "seller", "both"];
export const VALID_BUDGET_CURRENCIES = ["USD", "ARS"];

/** Normalize client status synonyms to the canonical hot/warm/cold scale */
export function normalizeClientStatus(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  const HOT_SYNONYMS = ["hot", "caliente", "interesado", "prospect", "prospecto"];
  const WARM_SYNONYMS = ["warm", "tibio", "active", "activo", "seguimiento", "en seguimiento"];
  const COLD_SYNONYMS = ["cold", "frio", "frío", "inactive", "inactivo", "sin actividad", "cerrado", "closed", "baja"];
  if (HOT_SYNONYMS.includes(s)) return "hot";
  if (WARM_SYNONYMS.includes(s)) return "warm";
  if (COLD_SYNONYMS.includes(s)) return "cold";
  return null;
}
export const VALID_CONVERSATION_TYPES = ["search", "email", "followup", "general"];

/**
 * Resuelve el status al CREAR un cliente.
 * - Sinónimo reconocido (incl. "frío"/"inactive") → su valor canónico (hot/warm/cold).
 * - Sin status (nuevo lead) → "hot" (default del producto).
 * - Status provisto pero NO reconocido → "warm" (neutral): nunca promovemos a "hot" un valor
 *   que el modelo no expresó como caliente (evita que un cliente "frío" termine "caliente").
 */
export function resolveClientStatusForCreate(raw: unknown): string {
  const normalized = normalizeClientStatus(raw);
  if (normalized) return normalized;
  return raw == null || raw === "" ? "hot" : "warm";
}

/** Sanitize ILIKE patterns – escape wildcards and limit length */
export function sanitizePattern(val: unknown): string | null {
  if (typeof val !== "string" || val.trim() === "") return null;
  return val.replace(/[%_\\]/g, "\\$&").slice(0, 100);
}

/** Safe positive number validation. Coerce strings numéricas (el modelo a veces manda
 *  "50000" en vez de 50000) con el mismo criterio que safePositiveInt, sin descartarlas. */
export function safePositiveNumber(val: unknown): number | null {
  if (typeof val !== "number" && typeof val !== "string") return null;
  if (typeof val === "string" && val.trim() === "") return null;
  const n = Number(val);
  return isFinite(n) && n >= 0 ? n : null;
}

/** Safe positive integer validation */
export function safePositiveInt(val: unknown): number | null {
  const n = parseInt(String(val));
  return !isNaN(n) && n >= 0 ? n : null;
}

/** Map DB errors to safe user-facing messages */
export function safeDbError(error: any): string {
  console.error("Tool DB error:", error?.code, error?.message);
  if (error?.code === "23505") return "Registro duplicado";
  if (error?.code === "23503") return "Referencia inválida";
  if (error?.code?.startsWith("23")) return "Error de validación";
  return "Error al procesar la solicitud";
}

/** Current date in Córdoba (UTC-3) as YYYY-MM-DD. */
export function todayCordobaISO(now: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD; el timeZone resuelve el offset (incl. histórico) sin hacks.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Cordoba" }).format(now);
}

/** Suma `days` a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD (aritmética en UTC, sin DST). */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Próxima ocurrencia (YYYY-MM-DD) de un evento recurrente, relativa a hoy en Córdoba.
 * Compara por fecha (no por instante) para que un evento de HOY se agende hoy y no al período siguiente.
 * Para `once` devuelve la fecha original. Ajusta días inexistentes (29-feb, día 31) al último día del mes.
 */
export function nextOccurrenceISO(
  eventDate: string,
  recurrence: string,
  todayISO: string = todayCordobaISO(),
): string {
  const [, em, ed] = eventDate.split("-").map(Number);
  if (recurrence === "once") return eventDate;

  // Día válido para (año, mes 1-based), recortado al último día del mes.
  const make = (year: number, month: number): string => {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(ed, lastDay);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const [ty, tm] = todayISO.split("-").map(Number);

  if (recurrence === "monthly") {
    let year = ty;
    let month = tm;
    let iso = make(year, month);
    if (iso < todayISO) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
      iso = make(year, month);
    }
    return iso;
  }

  // yearly (default)
  let iso = make(ty, em);
  if (iso < todayISO) iso = make(ty + 1, em);
  return iso;
}

/**
 * Implementación ÚNICA y compartida de normalización de datetime a hora de Córdoba (UTC-3).
 * Usada tanto al crear como al editar eventos (antes había una copia en google.ts con lógica
 * distinta: date-only fallaba en una y asumía 09:00 en la otra). Casos soportados:
 *  - con tz (+hh:mm o Z): se parsea tal cual.
 *  - solo fecha (YYYY-MM-DD): se asume 09:00 hora Córdoba.
 *  - fecha y hora sin tz ("2026-02-20T16:00" / "2026-02-20 16:00"): se asume Córdoba (-03:00).
 *  - solo hora ("16:00"): se combina con HOY en Córdoba.
 */
export function normalizeDatetime(raw: string): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // Already has timezone info (Z o ±hh:mm, incluye offsets negativos)
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // Only date (YYYY-MM-DD) → assume 09:00 Córdoba
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T09:00:00-03:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  // Has date and time (e.g. "2026-02-20T16:00" or "2026-02-20 16:00")
  const withTz = s.replace(" ", "T") + "-03:00";
  const d = new Date(withTz);
  if (!isNaN(d.getTime())) return d;
  // Only time provided (e.g. "16:00") — combine with today in Córdoba
  const timeMatch = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (timeMatch) {
    const d2 = new Date(`${todayCordobaISO()}T${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}:00-03:00`);
    return isNaN(d2.getTime()) ? null : d2;
  }
  return null;
}
