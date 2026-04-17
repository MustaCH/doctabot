// Validation helpers and constants used across tool execution

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const VALID_CLIENT_STATUSES = ["hot", "warm", "cold"];
export const VALID_CLIENT_TYPES = ["buyer", "seller", "both"];
export const VALID_BUDGET_CURRENCIES = ["USD", "ARS"];
export const VALID_CONVERSATION_TYPES = ["search", "email", "followup", "general"];

/** Sanitize ILIKE patterns – escape wildcards and limit length */
export function sanitizePattern(val: unknown): string | null {
  if (typeof val !== "string" || val.trim() === "") return null;
  return val.replace(/[%_\\]/g, "\\$&").slice(0, 100);
}

/** Safe positive number validation */
export function safePositiveNumber(val: unknown): number | null {
  const n = Number(val);
  return typeof val === "number" && isFinite(n) && n >= 0 ? n : null;
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

/** Normalize a datetime string to full ISO format in Argentina time (UTC-3) */
export function normalizeDatetime(raw: string): Date | null {
  if (!raw) return null;
  // Already has timezone info
  if (raw.includes("+") || raw.endsWith("Z")) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  // Has date and time (e.g. "2026-02-20T16:00" or "2026-02-20 16:00")
  const withTz = raw.replace(" ", "T") + "-03:00";
  const d = new Date(withTz);
  if (!isNaN(d.getTime())) return d;
  // Only time provided (e.g. "16:00") — combine with today in Argentina
  const nowArg = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dateStr = nowArg.toISOString().slice(0, 10);
  const timeMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (timeMatch) {
    const d2 = new Date(`${dateStr}T${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}:00-03:00`);
    return isNaN(d2.getTime()) ? null : d2;
  }
  return null;
}
