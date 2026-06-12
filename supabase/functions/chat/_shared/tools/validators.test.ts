import { describe, it, expect } from "vitest";
import { todayCordobaISO, nextOccurrenceISO, addDaysISO } from "./validators";

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
