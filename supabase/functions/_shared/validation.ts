// Helpers de validación de inputs, sin dependencias (testeables en vitest).
// Mismo estilo manual que chat/_shared/tools/validators.ts.

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// Duplicado a propósito de chat/_shared/tools/validators.ts para mantener
// este _shared raíz desacoplado del _shared interno de chat.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireString(
  value: unknown,
  field: string,
  opts: { minLength?: number; maxLength?: number } = {},
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${field} es requerido`);
  }
  const v = value.trim();
  if (opts.minLength != null && v.length < opts.minLength) {
    throw new ValidationError(`${field} es demasiado corto`);
  }
  if (opts.maxLength != null && v.length > opts.maxLength) {
    throw new ValidationError(`${field} excede el largo máximo`);
  }
  return v;
}

export function optionalString(
  value: unknown,
  field: string,
  opts: { maxLength?: number } = {},
): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new ValidationError(`${field} debe ser texto`);
  const v = value.trim();
  if (v === "") return null;
  if (opts.maxLength != null && v.length > opts.maxLength) {
    throw new ValidationError(`${field} excede el largo máximo`);
  }
  return v;
}

export function requireUuid(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!UUID_REGEX.test(v)) {
    throw new ValidationError(`${field} inválido`);
  }
  return v;
}

export function requireNonEmptyArray<T = unknown>(
  value: unknown,
  field: string,
  opts: { maxItems?: number } = {},
): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`${field} es requerido`);
  }
  if (opts.maxItems != null && value.length > opts.maxItems) {
    throw new ValidationError(`${field} tiene demasiados elementos`);
  }
  return value as T[];
}

export function optionalArray<T = unknown>(
  value: unknown,
  field: string,
  opts: { maxItems?: number } = {},
): T[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} debe ser una lista`);
  if (opts.maxItems != null && value.length > opts.maxItems) {
    throw new ValidationError(`${field} tiene demasiados elementos`);
  }
  return value as T[];
}
