import { describe, it, expect } from "vitest";
import { todayCordobaISO, nextOccurrenceISO, addDaysISO, normalizeClientStatus, resolveClientStatusForCreate, safePositiveNumber, normalizeDatetime } from "./validators";

describe("normalizeDatetime (única, compartida create/update)", () => {
  it("solo fecha (YYYY-MM-DD) asume 09:00 Córdoba — idéntico en crear y editar", () => {
    const d = normalizeDatetime("2026-02-20");
    expect(d).not.toBeNull();
    // 09:00 -03:00 == 12:00 UTC
    expect(d!.toISOString()).toBe("2026-02-20T12:00:00.000Z");
  });
  it("fecha y hora sin tz asume Córdoba (-03:00)", () => {
    expect(normalizeDatetime("2026-02-20T16:00")!.toISOString()).toBe("2026-02-20T19:00:00.000Z");
    expect(normalizeDatetime("2026-02-20 16:00")!.toISOString()).toBe("2026-02-20T19:00:00.000Z");
  });
  it("respeta tz explícita", () => {
    expect(normalizeDatetime("2026-02-20T16:00:00Z")!.toISOString()).toBe("2026-02-20T16:00:00.000Z");
    expect(normalizeDatetime("2026-02-20T16:00:00-05:00")!.toISOString()).toBe("2026-02-20T21:00:00.000Z");
  });
  it("solo hora (HH:MM) se combina con hoy en Córdoba", () => {
    const d = normalizeDatetime("16:00");
    expect(d).not.toBeNull();
    expect(d!.toISOString().slice(0, 10)).toBe(todayCordobaISO());
  });
  it("vacío o inválido devuelve null", () => {
    expect(normalizeDatetime("")).toBeNull();
    expect(normalizeDatetime("no es fecha")).toBeNull();
  });
});

describe("safePositiveNumber", () => {
  it("acepta números positivos y cero", () => {
    expect(safePositiveNumber(50000)).toBe(50000);
    expect(safePositiveNumber(0)).toBe(0);
    expect(safePositiveNumber(1234.56)).toBe(1234.56);
  });
  it("coerce strings numéricas (el modelo a veces manda '50000')", () => {
    expect(safePositiveNumber("50000")).toBe(50000);
    expect(safePositiveNumber("  1200.5 ")).toBe(1200.5);
  });
  it("rechaza negativos, vacío, no-numérico y tipos raros", () => {
    expect(safePositiveNumber(-1)).toBeNull();
    expect(safePositiveNumber("-5")).toBeNull();
    expect(safePositiveNumber("")).toBeNull();
    expect(safePositiveNumber("abc")).toBeNull();
    expect(safePositiveNumber(undefined)).toBeNull();
    expect(safePositiveNumber(null)).toBeNull();
    expect(safePositiveNumber(true)).toBeNull();
    expect(safePositiveNumber({})).toBeNull();
  });
});

describe("normalizeClientStatus", () => {
  it("mapea sinónimos de frío a cold (incluye 'inactive')", () => {
    for (const s of ["cold", "frío", "frio", "inactive", "inactivo", "sin actividad", "baja"]) {
      expect(normalizeClientStatus(s)).toBe("cold");
    }
  });
  it("mapea caliente/tibio correctamente y es case-insensitive", () => {
    expect(normalizeClientStatus("CALIENTE")).toBe("hot");
    expect(normalizeClientStatus("  En Seguimiento ")).toBe("warm");
  });
  it("devuelve null para valores no reconocidos o no-string", () => {
    expect(normalizeClientStatus("banana")).toBeNull();
    expect(normalizeClientStatus(undefined)).toBeNull();
    expect(normalizeClientStatus(42)).toBeNull();
  });
});

describe("resolveClientStatusForCreate", () => {
  it("frío/inactive se persisten como cold (nunca hot) — caso Mauri Quiñones", () => {
    expect(resolveClientStatusForCreate("frío")).toBe("cold");
    expect(resolveClientStatusForCreate("inactive")).toBe("cold");
    expect(resolveClientStatusForCreate("cold")).toBe("cold");
  });
  it("sin status (nuevo lead) defaultea a hot", () => {
    expect(resolveClientStatusForCreate(undefined)).toBe("hot");
    expect(resolveClientStatusForCreate(null)).toBe("hot");
    expect(resolveClientStatusForCreate("")).toBe("hot");
  });
  it("status provisto pero no reconocido NO cae a hot: cae a warm (neutral)", () => {
    expect(resolveClientStatusForCreate("banana")).toBe("warm");
  });
});

describe("todayCordobaISO", () => {
  it("devuelve la fecha en Córdoba (UTC-3) en formato YYYY-MM-DD", () => {
    // 2026-06-12 01:00 UTC → en Córdoba sigue siendo 2026-06-11 (22:00)
    expect(todayCordobaISO(new Date("2026-06-12T01:00:00Z"))).toBe("2026-06-11");
    // 2026-06-12 12:00 UTC → 09:00 en Córdoba, mismo día
    expect(todayCordobaISO(new Date("2026-06-12T12:00:00Z"))).toBe("2026-06-12");
  });
});

describe("addDaysISO", () => {
  it("suma días cruzando fin de mes y de año", () => {
    expect(addDaysISO("2026-06-12", 0)).toBe("2026-06-12");
    expect(addDaysISO("2026-06-12", 90)).toBe("2026-09-10");
    expect(addDaysISO("2026-12-20", 30)).toBe("2027-01-19");
  });
});

describe("nextOccurrenceISO", () => {
  const today = "2026-06-12";

  it("un evento yearly cuya fecha es HOY se agenda para hoy, no el año siguiente", () => {
    expect(nextOccurrenceISO("1990-06-12", "yearly", today)).toBe("2026-06-12");
  });

  it("un evento yearly ya pasado este año se agenda para el año siguiente", () => {
    expect(nextOccurrenceISO("1990-03-01", "yearly", today)).toBe("2027-03-01");
  });

  it("un evento yearly futuro este año se agenda para este año", () => {
    expect(nextOccurrenceISO("1990-12-25", "yearly", today)).toBe("2026-12-25");
  });

  it("yearly 29-feb se ajusta al último día de feb en años no bisiestos", () => {
    expect(nextOccurrenceISO("2000-02-29", "yearly", "2027-06-12")).toBe("2028-02-29");
    expect(nextOccurrenceISO("2000-02-29", "yearly", "2026-03-01")).toBe("2027-02-28");
  });

  it("monthly cuyo día es hoy se agenda para hoy", () => {
    expect(nextOccurrenceISO("2026-01-12", "monthly", today)).toBe("2026-06-12");
  });

  it("monthly ya pasado este mes se agenda para el mes siguiente", () => {
    expect(nextOccurrenceISO("2026-01-05", "monthly", today)).toBe("2026-07-05");
  });

  it("monthly que cruza diciembre rota al año siguiente", () => {
    expect(nextOccurrenceISO("2026-01-05", "monthly", "2026-12-20")).toBe("2027-01-05");
  });

  it("monthly día 31 se ajusta al último día de meses cortos", () => {
    expect(nextOccurrenceISO("2026-01-31", "monthly", "2026-02-01")).toBe("2026-02-28");
  });

  it("once devuelve la fecha original sin recalcular", () => {
    expect(nextOccurrenceISO("2025-01-01", "once", today)).toBe("2025-01-01");
    expect(nextOccurrenceISO("2030-09-15", "once", today)).toBe("2030-09-15");
  });
});
