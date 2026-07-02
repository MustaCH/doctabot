// QA — Test de integración del CONTRATO entre el backend (chat/_shared/card-render) y el front.
// El backend arma las tarjetas de contacto con renderContactCard/expandContactCards; el front las
// parsea con parseContactCard / parseContactCardSegments. Los unit tests prueban cada lado por
// separado; esto valida que lo que emite el backend es lo que el front sabe leer.
// Espejo de src/lib/match-card-contract.test.ts (tarjetas de propiedad).
import { describe, it, expect } from "vitest";
import {
  renderContactCard,
  expandContactCards,
  type ContactCardData,
} from "../../supabase/functions/chat/_shared/card-render";
import { MSG_BREAK } from "../../supabase/functions/chat/_shared/alan-facts";
import {
  parseContactCard,
  parseContactCardSegments,
  parseLastContactDays,
  lastContactTone,
} from "@/lib/contact-card-parse";

const NOW = new Date("2026-07-02T12:00:00-03:00");

function contact(o: Partial<ContactCardData>): ContactCardData {
  return {
    id: "c1",
    full_name: "Julieta Moreno",
    phone: "+5493512001365",
    email: "julieta@mail.com",
    status: "cold",
    client_type: "both",
    is_client: true,
    preferred_zones: "Alta Córdoba",
    budget_max: 80000,
    budget_currency: "USD",
    property_type_interest: "Local comercial",
    last_contact_at: "2026-06-20T10:00:00-03:00", // hace 12 días respecto de NOW
    ...o,
  };
}

describe("contrato chat/card-render → ContactCard (single)", () => {
  it("el front extrae todos los campos de la tarjeta completa que emite el backend", () => {
    const card = parseContactCard(renderContactCard(contact({}), NOW));
    expect(card).not.toBeNull();
    expect(card!.name).toBe("Julieta Moreno");
    expect(card!.typeLabel).toBe("Comprador/Vendedor");
    expect(card!.status).toBe("cold");
    expect(card!.phone).toBe("+5493512001365");
    expect(card!.email).toBe("julieta@mail.com");
    expect(card!.seeking).toBe("Local comercial · en Alta Córdoba · hasta USD 80.000");
    expect(card!.lastContactLabel).toBe("hace 12 días");
    expect(card!.lastContactDays).toBe(12);
  });

  it("tarjeta mínima (solo nombre, nunca contactado) parsea igual, sin inventar campos", () => {
    const md = renderContactCard(
      contact({
        phone: null, email: null, status: null, client_type: null,
        preferred_zones: null, budget_max: null, property_type_interest: null,
        last_contact_at: null,
      }),
      NOW,
    );
    const card = parseContactCard(md);
    expect(card).not.toBeNull();
    expect(card!.name).toBe("Julieta Moreno");
    expect(card!.typeLabel).toBeUndefined();
    expect(card!.status).toBeUndefined();
    expect(card!.phone).toBeUndefined();
    expect(card!.email).toBeUndefined();
    expect(card!.seeking).toBeUndefined();
    expect(card!.lastContactLabel).toBe("nunca");
    expect(card!.lastContactDays).toBeNull();
  });

  it("un no-cliente (is_client=false) lleva chip 'Contacto' y sin estado", () => {
    const card = parseContactCard(renderContactCard(contact({ is_client: false }), NOW));
    expect(card!.typeLabel).toBe("Contacto");
    expect(card!.status).toBeUndefined();
  });

  it("la tarjeta del backend nunca contiene 🏠 (no dispara el detector de propiedades)", () => {
    const md = renderContactCard(contact({}), NOW);
    expect(md).not.toContain("🏠");
  });
});

describe("contrato chat/card-render → ContactCard (multi, como el mensaje real)", () => {
  it("expandContactCards emite una burbuja por contacto, cada una parseable", () => {
    const { text } = expandContactCards(
      "Acá tenés los fríos para hoy:\n===MSG_BREAK===\n<<<CONTACTS>>>",
      [contact({}), contact({ full_name: "Pedro Gómez", status: "hot", client_type: "buyer" })],
      NOW,
    );
    const bubbles = text.split(MSG_BREAK).map((b) => b.trim()).filter(Boolean);
    expect(bubbles).toHaveLength(3); // intro + 2 contactos

    const first = parseContactCardSegments(bubbles[1]);
    expect(first).not.toBeNull();
    expect(first![0].type).toBe("contact");
    expect(first![0].contact!.name).toBe("Julieta Moreno");

    const second = parseContactCardSegments(bubbles[2]);
    expect(second![0].contact!.name).toBe("Pedro Gómez");
    expect(second![0].contact!.typeLabel).toBe("Comprador");
    expect(second![0].contact!.status).toBe("hot");
  });

  it("texto antes de la tarjeta en la misma burbuja queda como segmento de texto", () => {
    const md = `Este es el más urgente:\n${renderContactCard(contact({}), NOW)}`;
    const segments = parseContactCardSegments(md);
    expect(segments).not.toBeNull();
    expect(segments![0]).toEqual({ type: "text", text: "Este es el más urgente:" });
    expect(segments![1].type).toBe("contact");
  });

  it("un bloque que no cumple el contrato (sin 🕓) cae a texto, no rompe", () => {
    const segments = parseContactCardSegments("👤 **Alguien**\n📱 +549351111\ny acá prosa suelta");
    expect(segments).toBeNull(); // ninguna tarjeta parseable → el caller renderiza markdown
  });

  it("prosa sin tarjetas no dispara el parser", () => {
    expect(parseContactCardSegments("Tenés 43 contactos fríos en total.")).toBeNull();
  });
});

describe("línea opcional [Ver perfil](/clients/{id}) — punto abierto del handoff, opción (a)", () => {
  it("si el backend agrega la línea, el front extrae la ruta interna", () => {
    const md = `${renderContactCard(contact({}), NOW)}\n[Ver perfil](/clients/3f2a1b00-1111-2222-3333-444455556666)`;
    const segments = parseContactCardSegments(md);
    expect(segments![0].type).toBe("contact");
    expect(segments![0].contact!.profilePath).toBe("/clients/3f2a1b00-1111-2222-3333-444455556666");
  });

  it("sin la línea, profilePath queda undefined (el botón no se muestra)", () => {
    const card = parseContactCard(renderContactCard(contact({}), NOW));
    expect(card!.profilePath).toBeUndefined();
  });
});

describe("indicador de último contacto (semáforo)", () => {
  it("hoy/ayer/hace N días → días; nunca → null", () => {
    expect(parseLastContactDays("hoy")).toBe(0);
    expect(parseLastContactDays("ayer")).toBe(1);
    expect(parseLastContactDays("hace 12 días")).toBe(12);
    expect(parseLastContactDays("nunca")).toBeNull();
  });

  it("verde <7 / amarillo <30 / rojo ≥30 o nunca", () => {
    expect(lastContactTone(0)).toBe("green");
    expect(lastContactTone(6)).toBe("green");
    expect(lastContactTone(7)).toBe("amber");
    expect(lastContactTone(29)).toBe("amber");
    expect(lastContactTone(30)).toBe("red");
    expect(lastContactTone(null)).toBe("red");
  });
});
