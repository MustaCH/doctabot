// Lógica pura del import de contactos desde CSV/XLSX.
// Separada del componente para poder testearla sin montar React.

export interface ColumnMapping {
  name_column: number;
  phone_column: number;
  email_column: number;
  client_type_column: number;
  preferred_zones_column: number;
  budget_min_column: number;
  budget_max_column: number;
  property_type_interest_column: number;
  birthday_column: number;
  company_column: number;
  address_column: number;
  source_column: number;
  extra_columns: number[];
  has_name_split: boolean;
  name_column_2: number;
}

export interface ParsedClient {
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  client_type: string;
  birthday?: string | null;
  company?: string | null;
  address?: string | null;
  preferred_zones?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  property_type_interest?: string | null;
  source?: string | null;
}

export type RowState = "new" | "duplicate" | "invalid";

export interface ParsedRow {
  data: ParsedClient;
  rowIndex: number; // 1-based, posición original en el archivo
  state: RowState;
  included: boolean;
}

export const ROW_ORDER: Record<RowState, number> = { invalid: 0, duplicate: 1, new: 2 };

/** Detecta client_type a partir del valor crudo de una celda. */
export function detectClientType(val: string | null | undefined): string {
  if (!val) return "buyer";
  const lower = val.trim().toLowerCase();
  if (lower.includes("vendedor") || lower === "seller") return "seller";
  if (lower.includes("ambos") || lower === "both") return "both";
  return "buyer";
}

/** Normaliza teléfono a solo dígitos; si tiene código de país, deja los últimos 10. */
export function normalizePhone(val: string | null | undefined): string {
  if (!val) return "";
  const digits = val.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeEmail(val: string | null | undefined): string {
  return (val ?? "").trim().toLowerCase();
}

/** Devuelve YYYY-MM-DD o null. Soporta dd/mm/yyyy (AR), ISO y serial de Excel. */
export function normalizeBirthday(raw: string | null | undefined): string | null {
  const val = (raw ?? "").trim();
  if (!val) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  const dmy = val.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const [, d, m, yRaw] = dmy;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    const dd = d.padStart(2, "0");
    const mm = m.padStart(2, "0");
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${y}-${mm}-${dd}`;
    return null;
  }
  // Serial de Excel (epoch 1899-12-30). Rango razonable para fechas modernas.
  if (/^\d{5}$/.test(val)) {
    const serial = parseInt(val, 10);
    if (serial > 20000 && serial < 60000) {
      const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
      return new Date(ms).toISOString().slice(0, 10);
    }
  }
  return null;
}

export function parseBudget(val: string | null | undefined): number | null {
  if (!val) return null;
  const cleaned = val.replace(/[^0-9.,]/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/** Aplica el mapeo a una fila → ParsedClient (sin decidir estado). */
export function mapRow(hdrs: string[], row: string[], m: ColumnMapping): ParsedClient {
  let name = row[m.name_column]?.trim() ?? "";
  if (m.has_name_split && m.name_column_2 >= 0 && m.name_column_2 < row.length) {
    const part2 = row[m.name_column_2]?.trim() ?? "";
    name = `${name} ${part2}`.trim();
  }

  const phone = m.phone_column >= 0 ? (row[m.phone_column]?.trim() || null) : null;
  const email = m.email_column >= 0 ? (row[m.email_column]?.trim() || null) : null;

  let client_type = "buyer";
  if (m.client_type_column >= 0) client_type = detectClientType(row[m.client_type_column]);

  const preferred_zones = m.preferred_zones_column >= 0 ? (row[m.preferred_zones_column]?.trim() || null) : null;
  const property_type_interest = m.property_type_interest_column >= 0 ? (row[m.property_type_interest_column]?.trim() || null) : null;
  const company = m.company_column >= 0 ? (row[m.company_column]?.trim() || null) : null;
  const address = m.address_column >= 0 ? (row[m.address_column]?.trim() || null) : null;
  const source = m.source_column >= 0 ? (row[m.source_column]?.trim() || null) : null;
  const budget_min = m.budget_min_column >= 0 ? parseBudget(row[m.budget_min_column]?.trim()) : null;
  const budget_max = m.budget_max_column >= 0 ? parseBudget(row[m.budget_max_column]?.trim()) : null;

  // Fecha: normalizar; si no se puede parsear, no romper el insert → cae a notas.
  const rawBirthday = m.birthday_column >= 0 ? (row[m.birthday_column]?.trim() || "") : "";
  const birthday = normalizeBirthday(rawBirthday);

  const noteParts: string[] = [];
  for (const idx of m.extra_columns) {
    const val = row[idx]?.trim();
    if (val) noteParts.push(`${hdrs[idx]}: ${val}`);
  }
  if (rawBirthday && !birthday) noteParts.push(`Cumpleaños: ${rawBirthday}`);
  const notes = noteParts.length > 0 ? noteParts.join("\n") : null;

  // Fallback: si no hubo columna de tipo, buscar "Vendedor/Ambos" en notas.
  if (m.client_type_column < 0 && notes) {
    if (/tipo\s*de\s*contacto\s*:\s*vendedor/i.test(notes)) client_type = "seller";
    else if (/tipo\s*de\s*contacto\s*:\s*ambos/i.test(notes)) client_type = "both";
  }

  return {
    full_name: name, phone, email, notes, client_type,
    preferred_zones, budget_min, budget_max, property_type_interest,
    birthday, company, address, source,
  };
}

/** Mapea todas las filas + decide estado (nuevo/duplicado/inválido). */
export function computeRows(
  hdrs: string[],
  rows: string[][],
  m: ColumnMapping,
  existing: { phones: Set<string>; emails: Set<string> },
  includeDuplicates: boolean,
): ParsedRow[] {
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  return rows.map((row, i) => {
    const data = mapRow(hdrs, row, m);
    let state: RowState;

    if (!data.full_name) {
      state = "invalid";
    } else {
      const p = normalizePhone(data.phone);
      const e = normalizeEmail(data.email);
      const dupExisting = (!!p && existing.phones.has(p)) || (!!e && existing.emails.has(e));
      const dupInFile = (!!p && seenPhones.has(p)) || (!!e && seenEmails.has(e));
      state = dupExisting || dupInFile ? "duplicate" : "new";
      if (p) seenPhones.add(p);
      if (e) seenEmails.add(e);
    }

    const included = state === "new" || (state === "duplicate" && includeDuplicates);
    return { data, rowIndex: i + 1, state, included };
  });
}

export function friendlyReason(msg: string): string {
  if (/date|fecha/i.test(msg)) return "Fecha inválida";
  if (/numeric|number|integer|budget|monto/i.test(msg)) return "Monto inválido";
  if (/duplicate key|unique/i.test(msg)) return "Ya existe en el sistema";
  return "No se pudo guardar";
}
