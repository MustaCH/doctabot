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

describe("línea [Ver perfil](/clients/{id}) — opción (a) del handoff, YA implementada server-side", () => {
  it("el server la emite cuando el contacto tiene id y el front extrae la ruta interna", () => {
    const card = parseContactCard(renderContactCard(contact({}), NOW));
    expect(card!.profilePath).toBe("/clients/c1"); // contact({}) trae id "c1"
  });

  it("sin id (contacto tipeado en el turno, no persistido), no hay línea y profilePath queda undefined", () => {
    const card = parseContactCard(renderContactCard(contact({ id: undefined }), NOW));
    expect(card!.profilePath).toBeUndefined();
  });
});

// Ticket 86ak3z04w: el server pasó a líneas rotuladas sin emoji. Los mensajes YA PERSISTIDOS en DB
// siguen con el formato viejo (🏷️ 📱 ✉️ 🔍 🕓 y estados 🔥/🟡/❄️) — el parser tiene que leer AMBOS
// (espejo de "una tarjeta vieja persistida y una nueva conviven" en match-card-contract.test.ts).
describe("retrocompat: mensajes viejos persistidos con emojis + formato nuevo", () => {
  const VIEJA = [
    "👤 **Carla Díaz**",
    "🏷️ Comprador · 🔥 Caliente",
    "📱 +5493515550001",
    "✉️ carla@mail.com",
    "🔍 Busca: Casa · en Villa Allende · hasta USD 150.000",
    "🕓 Último contacto: hace 3 días",
    "[Ver perfil](/clients/old-1)",
  ].join("\n");

  it("una tarjeta vieja (emojis) parsea con todos sus campos", () => {
    const card = parseContactCard(VIEJA);
    expect(card).not.toBeNull();
    expect(card!.name).toBe("Carla Díaz");
    expect(card!.typeLabel).toBe("Comprador");
    expect(card!.status).toBe("hot");
    expect(card!.phone).toBe("+5493515550001");
    expect(card!.email).toBe("carla@mail.com");
    expect(card!.seeking).toBe("Casa · en Villa Allende · hasta USD 150.000");
    expect(card!.lastContactLabel).toBe("hace 3 días");
    expect(card!.lastContactDays).toBe(3);
    expect(card!.profilePath).toBe("/clients/old-1");
  });

  it("los tres estados viejos (🔥 / 🟡 y ☀️ / ❄️) mapean a hot/warm/cold", () => {
    const mk = (chip: string) => parseContactCard(`👤 **X**\n🏷️ Vendedor · ${chip}\n🕓 Último contacto: nunca`)!.status;
    expect(mk("🔥 Caliente")).toBe("hot");
    expect(mk("🟡 Tibio")).toBe("warm");
    expect(mk("☀️ Tibio")).toBe("warm");
    expect(mk("❄️ Frío")).toBe("cold");
  });

  it("el formato nuevo del server no tiene emojis salvo el 👤 del título y parsea igual", () => {
    const md = renderContactCard(contact({ status: "hot", client_type: "seller" }), NOW);
    expect(md.match(/\p{Extended_Pictographic}/gu)).toEqual(["👤"]);
    const card = parseContactCard(md)!;
    expect(card.typeLabel).toBe("Vendedor");
    expect(card.status).toBe("hot");
    expect(card.phone).toBe("+5493512001365");
    expect(card.lastContactLabel).toBe("hace 12 días");
  });

  it("una tarjeta vieja persistida y una nueva conviven en el mismo mensaje", () => {
    const segments = parseContactCardSegments(`Dos contactos:\n${VIEJA}\n\n${renderContactCard(contact({}), NOW)}`);
    expect(segments).not.toBeNull();
    const cards = segments!.filter((s) => s.type === "contact").map((s) => s.contact!);
    expect(cards).toHaveLength(2);
    expect(cards[0].name).toBe("Carla Díaz");
    expect(cards[0].status).toBe("hot");
    expect(cards[1].name).toBe("Julieta Moreno");
    expect(cards[1].status).toBe("cold");
    expect(cards[1].typeLabel).toBe("Comprador/Vendedor");
    // ningún segmento de texto con emojis huérfanos ni líneas rotuladas crudas
    const texts = segments!.filter((s) => s.type === "text").map((s) => s.text!);
    expect(texts).toEqual(["Dos contactos:"]);
  });

  it("prosa después de una tarjeta nueva cierra el bloque (las líneas rotuladas no se 'comen' el texto)", () => {
    const md = `${renderContactCard(contact({}), NOW)}\n¿Le mando el mensaje?`;
    const segments = parseContactCardSegments(md)!;
    expect(segments[0].type).toBe("contact");
    expect(segments[1]).toEqual({ type: "text", text: "¿Le mando el mensaje?" });
  });

  it("expectativa conocida: una línea de prosa que arranca con un rótulo (Email:) PEGADA a la tarjeta se absorbe en el bloque", () => {
    // Mismo riesgo que ya asume el parser de propiedades con Precio:/Oficina:. En la práctica no
    // pasa: el server emite una tarjeta por burbuja (===MSG_BREAK===) y el cierre va en otra.
    const md = `${renderContactCard(contact({ email: null }), NOW)}\nEmail: te lo paso después`;
    const segments = parseContactCardSegments(md)!;
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("contact");
    expect(segments[0].contact!.email).toBe("te lo paso después");
  });

  it("Estado: tolera mayúsculas/minúsculas distintas del canónico", () => {
    const card = parseContactCard("👤 **X**\nEstado: caliente\nÚltimo contacto: nunca")!;
    expect(card.status).toBe("hot");
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
