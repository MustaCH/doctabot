// QA — Test de integración del CONTRATO entre el backend (morning-matches) y el front.
// El backend arma el mensaje con formatPropertyLine; el front lo parsea con
// parsePropertyCard / parseMultiplePropertyCards. Los unit tests prueban cada lado por
// separado; esto valida que lo que emite el backend es lo que el front sabe leer.
import { describe, it, expect } from "vitest";
import { formatPropertyLine } from "../../supabase/functions/morning-matches/format";
import type { PropertyRow } from "../../supabase/functions/morning-matches/matching";
import { parsePropertyCard, parseMultiplePropertyCards } from "@/lib/property-card-parse";

function prop(o: Partial<PropertyRow>): PropertyRow {
  return {
    id: "p1", zone: null, price: 120000, currency: "USD", property_type: "departamento_estandar",
    title: "Depto en Nueva Córdoba", locality: null, operation: null, address: "Bv. Illia 500",
    m2_total: 80, habitaciones: 2, photo: "https://cdn.example.com/foto.webp", url: "https://remax.com/p1",
    ...o,
  };
}

describe("contrato morning-matches → PropertyCard (single)", () => {
  it("el front extrae la foto principal que emite el backend", () => {
    const card = parsePropertyCard(formatPropertyLine(prop({})));
    expect(card).not.toBeNull();
    expect(card!.photo).toBe("https://cdn.example.com/foto.webp");
  });

  it("la superficie parseada dice 'dormitorios', no 'ambientes' ni 'hab.'", () => {
    const card = parsePropertyCard(formatPropertyLine(prop({ habitaciones: 2 })));
    expect(card!.surface).toContain("2 dormitorios");
    expect(card!.surface).not.toContain("hab.");
    expect(card!.surface).not.toContain("ambiente");
  });

  it("un título con paréntesis no rompe la extracción de la foto", () => {
    const card = parsePropertyCard(formatPropertyLine(prop({ title: "Depto (a estrenar) en Cofico" })));
    expect(card!.photo).toBe("https://cdn.example.com/foto.webp");
    expect(card!.title).toBe("Depto (a estrenar) en Cofico");
  });

  it("sin foto, el front no inventa imagen (cae al placeholder)", () => {
    const card = parsePropertyCard(formatPropertyLine(prop({ photo: null })));
    expect(card!.photo).toBeUndefined();
  });
});

describe("contrato morning-matches → PropertyCard (multi, como el mensaje real)", () => {
  it("agrupa cada propiedad con SU foto en un mensaje de varios matches", () => {
    // Replica el armado de index.ts: cada propiedad seguida de la línea '_Coincide por_'.
    const message = [
      "🔔 **Nuevas propiedades para Juan**\n",
      "🔍 **Busca:** Departamento en Nueva Córdoba · Hasta USD 120.000 · 🔥 Caliente\n",
      "Encontré 2 propiedades que coinciden:\n",
      formatPropertyLine(prop({ id: "a", title: "Depto A", photo: "https://cdn.example.com/a.webp" })),
      "_Coincide por: 📍 Zona, 💰 Presupuesto_\n",
      formatPropertyLine(prop({ id: "b", title: "Depto B", photo: "https://cdn.example.com/b.webp", habitaciones: 1 })),
      "_Coincide por: 📍 Zona, 🏗️ Tipo_\n",
    ].join("\n");

    const segments = parseMultiplePropertyCards(message);
    expect(segments).not.toBeNull();
    const cards = segments!.filter((s) => s.type === "property").map((s) => s.property!);
    expect(cards).toHaveLength(2);
    expect(cards[0].photo).toBe("https://cdn.example.com/a.webp");
    expect(cards[0].surface).toContain("2 dormitorios");
    expect(cards[1].photo).toBe("https://cdn.example.com/b.webp");
    expect(cards[1].surface).toContain("1 dormitorio");
  });
});
