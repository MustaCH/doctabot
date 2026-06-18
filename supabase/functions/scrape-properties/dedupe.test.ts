import { describe, it, expect } from "vitest";
import { dedupeByExternalId } from "./dedupe";

describe("dedupeByExternalId", () => {
  it("deja pasar filas con external_id únicos sin tocar nada", () => {
    const rows = [
      { external_id: "a", title: "uno" },
      { external_id: "b", title: "dos" },
    ];
    const { deduped, dropped } = dedupeByExternalId(rows);
    expect(deduped).toEqual(rows);
    expect(dropped).toBe(0);
  });

  it("colapsa duplicados por external_id quedándose con la última ocurrencia", () => {
    const rows = [
      { external_id: "a", title: "viejo" },
      { external_id: "b", title: "dos" },
      { external_id: "a", title: "nuevo" },
    ];
    const { deduped, dropped } = dedupeByExternalId(rows);
    expect(dropped).toBe(1);
    expect(deduped).toHaveLength(2);
    // la fila "a" sobreviviente es la última (más reciente)
    expect(deduped.find((r) => r.external_id === "a")?.title).toBe("nuevo");
  });

  it("preserva el orden de primera aparición de cada external_id", () => {
    const rows = [
      { external_id: "a", n: 1 },
      { external_id: "b", n: 2 },
      { external_id: "a", n: 3 },
      { external_id: "c", n: 4 },
    ];
    const { deduped } = dedupeByExternalId(rows);
    expect(deduped.map((r) => r.external_id)).toEqual(["a", "b", "c"]);
  });

  it("cuenta múltiples duplicados del mismo external_id", () => {
    const rows = [
      { external_id: "a", n: 1 },
      { external_id: "a", n: 2 },
      { external_id: "a", n: 3 },
    ];
    const { deduped, dropped } = dedupeByExternalId(rows);
    expect(deduped).toHaveLength(1);
    expect(dropped).toBe(2);
    expect(deduped[0].n).toBe(3);
  });

  it("maneja un array vacío", () => {
    const { deduped, dropped } = dedupeByExternalId([]);
    expect(deduped).toEqual([]);
    expect(dropped).toBe(0);
  });
});
