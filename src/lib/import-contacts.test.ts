import { describe, it, expect } from "vitest";
import {
  normalizePhone, normalizeEmail, normalizeBirthday, detectClientType,
  parseBudget, mapRow, computeRows, friendlyReason,
  type ColumnMapping,
} from "./import-contacts";

/** Mapping con todo en -1; override lo que el test necesite. */
function mapping(partial: Partial<ColumnMapping> = {}): ColumnMapping {
  return {
    name_column: 0, phone_column: -1, email_column: -1, client_type_column: -1,
    preferred_zones_column: -1, budget_min_column: -1, budget_max_column: -1,
    property_type_interest_column: -1, birthday_column: -1, company_column: -1,
    address_column: -1, source_column: -1, extra_columns: [],
    has_name_split: false, name_column_2: -1, ...partial,
  };
}

const noExisting = { phones: new Set<string>(), emails: new Set<string>() };

describe("normalizePhone", () => {
  it("deja solo dígitos", () => {
    expect(normalizePhone("(351) 555-1234")).toBe("3515551234");
  });
  it("recorta el código de país a los últimos 10 dígitos", () => {
    expect(normalizePhone("+54 9 351 555 1234")).toBe("3515551234");
  });
  it("hace match entre con y sin código de país", () => {
    expect(normalizePhone("+5493515551234")).toBe(normalizePhone("3515551234"));
  });
  it("devuelve string vacío para null/empty", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("normalizeEmail", () => {
  it("trim + lowercase", () => {
    expect(normalizeEmail("  Juan@Mail.COM ")).toBe("juan@mail.com");
  });
});

describe("normalizeBirthday", () => {
  it("parsea dd/mm/yyyy (formato AR)", () => {
    expect(normalizeBirthday("05/12/1980")).toBe("1980-12-05");
  });
  it("acepta separadores - y .", () => {
    expect(normalizeBirthday("5-3-1990")).toBe("1990-03-05");
    expect(normalizeBirthday("5.3.1990")).toBe("1990-03-05");
  });
  it("expande año de 2 dígitos", () => {
    expect(normalizeBirthday("05/12/80")).toBe("2080-12-05");
  });
  it("deja pasar ISO", () => {
    expect(normalizeBirthday("1980-12-05")).toBe("1980-12-05");
  });
  it("convierte serial de Excel", () => {
    // 33848 = 1992-09-01 (epoch Excel 1899-12-30)
    expect(normalizeBirthday("33848")).toBe("1992-09-01");
  });
  it("devuelve null para fechas inválidas o vacías", () => {
    expect(normalizeBirthday("no es fecha")).toBeNull();
    expect(normalizeBirthday("45/45/2020")).toBeNull();
    expect(normalizeBirthday("")).toBeNull();
    expect(normalizeBirthday(null)).toBeNull();
  });
});

describe("detectClientType", () => {
  it("detecta vendedor/seller", () => {
    expect(detectClientType("Vendedor")).toBe("seller");
    expect(detectClientType("seller")).toBe("seller");
  });
  it("detecta ambos/both", () => {
    expect(detectClientType("Ambos")).toBe("both");
  });
  it("default buyer", () => {
    expect(detectClientType("Comprador")).toBe("buyer");
    expect(detectClientType(null)).toBe("buyer");
  });
});

describe("parseBudget", () => {
  it("limpia símbolos y separadores", () => {
    expect(parseBudget("USD 120.000")).toBe(120.0); // "." tratado como decimal
    expect(parseBudget("$1500")).toBe(1500);
  });
  it("null para vacío o no numérico", () => {
    expect(parseBudget("")).toBeNull();
    expect(parseBudget("ND")).toBeNull();
  });
});

describe("mapRow", () => {
  it("concatena nombre + apellido cuando has_name_split", () => {
    const m = mapping({ name_column: 0, name_column_2: 1, has_name_split: true });
    expect(mapRow(["Nombre", "Apellido"], ["Ana", "Gómez"], m).full_name).toBe("Ana Gómez");
  });
  it("vuelca columnas extra a notas", () => {
    const m = mapping({ name_column: 0, extra_columns: [1] });
    const r = mapRow(["Nombre", "Obs"], ["Ana", "le interesa zona norte"], m);
    expect(r.notes).toBe("Obs: le interesa zona norte");
  });
  it("manda cumpleaños inválido a notas en vez de romper", () => {
    const m = mapping({ name_column: 0, birthday_column: 1 });
    const r = mapRow(["Nombre", "Cumple"], ["Ana", "no sé"], m);
    expect(r.birthday).toBeNull();
    expect(r.notes).toContain("Cumpleaños: no sé");
  });
});

describe("computeRows — estados y dedup", () => {
  const hdrs = ["Nombre", "Tel", "Email"];
  const m = mapping({ name_column: 0, phone_column: 1, email_column: 2 });

  it("marca invalid las filas sin nombre", () => {
    const rows = [["", "3515551234", ""]];
    expect(computeRows(hdrs, rows, m, noExisting, false)[0].state).toBe("invalid");
  });

  it("marca duplicate por teléfono repetido dentro del archivo", () => {
    const rows = [
      ["Ana", "351 555 1234", ""],
      ["Ana (otra carga)", "+5493515551234", ""],
    ];
    const out = computeRows(hdrs, rows, m, noExisting, false);
    expect(out[0].state).toBe("new");
    expect(out[1].state).toBe("duplicate");
  });

  it("marca duplicate por email contra contactos existentes", () => {
    const rows = [["Ana", "", "ANA@mail.com"]];
    const existing = { phones: new Set<string>(), emails: new Set(["ana@mail.com"]) };
    expect(computeRows(hdrs, rows, m, existing, false)[0].state).toBe("duplicate");
  });

  it("excluye duplicados por default; includeDuplicates los incluye", () => {
    const rows = [
      ["Ana", "3515551234", ""],
      ["Ana", "3515551234", ""],
    ];
    expect(computeRows(hdrs, rows, m, noExisting, false)[1].included).toBe(false);
    expect(computeRows(hdrs, rows, m, noExisting, true)[1].included).toBe(true);
  });

  it("las filas nuevas vienen incluidas; las inválidas no", () => {
    const rows = [["Ana", "3515551234", ""], ["", "", ""]];
    const out = computeRows(hdrs, rows, m, noExisting, false);
    expect(out[0].included).toBe(true);
    expect(out[1].included).toBe(false);
  });

  it("sin teléfono ni email no marca duplicado falso", () => {
    const rows = [["Ana", "", ""], ["Beto", "", ""]];
    const out = computeRows(hdrs, rows, m, noExisting, false);
    expect(out.every(r => r.state === "new")).toBe(true);
  });

  it("conserva el rowIndex original (1-based)", () => {
    const rows = [["Ana", "1", ""], ["Beto", "2", ""]];
    const out = computeRows(hdrs, rows, m, noExisting, false);
    expect(out.map(r => r.rowIndex)).toEqual([1, 2]);
  });
});

describe("friendlyReason", () => {
  it("mapea errores comunes a lenguaje del usuario", () => {
    expect(friendlyReason('invalid input syntax for type date')).toBe("Fecha inválida");
    expect(friendlyReason('invalid input syntax for type numeric')).toBe("Monto inválido");
    expect(friendlyReason('duplicate key value violates unique constraint')).toBe("Ya existe en el sistema");
    expect(friendlyReason('something weird')).toBe("No se pudo guardar");
  });
});
