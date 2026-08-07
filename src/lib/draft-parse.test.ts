// Suite del parser de drafts (tickets: marcadores <<<...>>> renderizados crudos + parser robusto).
// Cubre el caso real del bug (campaña con 2 borradores inline que mencionan 🏠), la URL pegada a
// DRAFT_END con agentCode, marcadores pegados, drafts sin cerrar, WHATSAPP_TO huérfanos y la
// paridad streaming (MarkerStream) vs recarga (splitBubbles).

import { describe, it, expect } from "vitest";
import {
  parseDraftSegments,
  splitBubbles,
  stripDraftMarkers,
  stripAllMarkers,
  normalizeWhatsappNumber,
  hasDraftMarkers,
  type DraftSegment,
} from "./draft-parse";
import { injectAssociate } from "./inject-associate";
import { parseMultiplePropertyCards } from "./property-card-parse";
import { MarkerStream, MSG_BREAK } from "./stream-markers";

const textSegments = (segs: DraftSegment[]) =>
  segs.filter((s): s is Extract<DraftSegment, { type: "text" }> => s.type === "text");
const draftSegments = (segs: DraftSegment[]) =>
  segs.filter((s): s is Extract<DraftSegment, { type: "draft" }> => s.type === "draft");

/** INVARIANTE: ningún marcador llega jamás a un segmento de texto (ni al contenido del draft). */
function expectNoRawMarkers(segs: DraftSegment[]) {
  for (const s of segs) {
    const value = s.type === "text" ? s.text : s.draft;
    expect(value).not.toContain("<<<DRAFT_START>>>");
    expect(value).not.toContain("<<<DRAFT_END>>>");
    expect(value).not.toMatch(/<<<WHATSAPP_TO:/);
  }
}

describe("parseDraftSegments", () => {
  it("caso real del bug: 2 pares WHATSAPP_TO+DRAFT inline (pegados, con 🏠 adentro) → 2 drafts, cero <<< visibles", () => {
    const content =
      "Acá van los mensajes: " +
      "<<<WHATSAPP_TO:+5493511111111>>> <<<DRAFT_START>>>Hola Juan! Te comparto esta 🏠 casa en Argüello por USD 120.000: https://www.remax.com.ar/listings/casa-x1<<<DRAFT_END>>> " +
      "<<<WHATSAPP_TO:+5493512222222>>> <<<DRAFT_START>>>Hola Ana! Esta 🏠 casa en Villa Belgrano te puede interesar.<<<DRAFT_END>>> " +
      "¿Los mando?";
    const segs = parseDraftSegments(content)!;
    expect(segs).not.toBeNull();
    const drafts = draftSegments(segs);
    expect(drafts.length).toBe(2);
    expect(drafts[0].whatsappNumber).toBe("+5493511111111");
    expect(drafts[1].whatsappNumber).toBe("+5493512222222");
    expect(drafts[0].draft).toContain("🏠 casa en Argüello");
    expectNoRawMarkers(segs);
    // El texto alrededor se conserva.
    expect(textSegments(segs).map((s) => s.text).join(" ")).toContain("¿Los mando?");
  });

  it("URL remax pegada a DRAFT_END + agentCode: el ?associate queda DENTRO de la URL y el draft parsea", () => {
    const content =
      "<<<WHATSAPP_TO:+5493510000000>>> <<<DRAFT_START>>>Mirala acá: https://www.remax.com.ar/listings/casa-x1<<<DRAFT_END>>>";
    const processed = injectAssociate(content, "AR200123");
    // El marcador NO fue tragado por la URL…
    expect(processed).toContain("casa-x1?associate=AR200123<<<DRAFT_END>>>");
    expect(processed).not.toContain("DRAFT_END?associate");
    // …y el draft parsea con el associate adentro.
    const segs = parseDraftSegments(processed)!;
    const drafts = draftSegments(segs);
    expect(drafts.length).toBe(1);
    expect(drafts[0].draft).toContain("https://www.remax.com.ar/listings/casa-x1?associate=AR200123");
    expect(drafts[0].whatsappNumber).toBe("+5493510000000");
    expectNoRawMarkers(segs);
  });

  it("marcadores pegados sin espacios parsean igual", () => {
    const segs = parseDraftSegments(
      "hola<<<WHATSAPP_TO:+5493511234567>>><<<DRAFT_START>>>texto del draft<<<DRAFT_END>>>chau"
    )!;
    const drafts = draftSegments(segs);
    expect(drafts.length).toBe(1);
    expect(drafts[0].draft).toBe("texto del draft");
    expect(drafts[0].whatsappNumber).toBe("+5493511234567");
    expect(textSegments(segs).map((s) => s.text)).toEqual(["hola", "chau"]);
    expectNoRawMarkers(segs);
  });

  it("draft sin cerrar = draft igual (no texto crudo)", () => {
    const segs = parseDraftSegments("Te dejo el mensaje: <<<DRAFT_START>>>Hola, quedó a medias")!;
    const drafts = draftSegments(segs);
    expect(drafts.length).toBe(1);
    expect(drafts[0].draft).toBe("Hola, quedó a medias");
    expectNoRawMarkers(segs);
  });

  it("WHATSAPP_TO sin draft posterior no queda visible", () => {
    const segs = parseDraftSegments("<<<WHATSAPP_TO:+5493510000000>>> después te paso el texto")!;
    expect(draftSegments(segs).length).toBe(0);
    expect(textSegments(segs).map((s) => s.text)).toEqual(["después te paso el texto"]);
    expectNoRawMarkers(segs);
  });

  it("un draft de 5 chars es un draft (sin mínimo de 20 que descartaba el texto entero)", () => {
    const segs = parseDraftSegments("<<<DRAFT_START>>>Hola!<<<DRAFT_END>>>")!;
    const drafts = draftSegments(segs);
    expect(drafts.length).toBe(1);
    expect(drafts[0].draft).toBe("Hola!");
  });

  it("dos WHATSAPP_TO antes de un draft: gana el más cercano, el otro no queda crudo", () => {
    const segs = parseDraftSegments(
      "<<<WHATSAPP_TO:+5491111111111>>> <<<WHATSAPP_TO:+5492222222222>>> <<<DRAFT_START>>>Hola<<<DRAFT_END>>>"
    )!;
    const drafts = draftSegments(segs);
    expect(drafts.length).toBe(1);
    expect(drafts[0].whatsappNumber).toBe("+5492222222222");
    expectNoRawMarkers(segs);
  });

  it("barrido invariante: entradas degeneradas nunca dejan un marcador en un segmento", () => {
    const nasty = [
      "<<<DRAFT_END>>> suelto sin apertura",
      "<<<DRAFT_START>>><<<DRAFT_END>>>",
      "texto <<<WHATSAPP_TO:+549>>> y <<<DRAFT_END>>> perdidos",
      "a<<<DRAFT_START>>>b<<<DRAFT_START>>>c<<<DRAFT_END>>>d",
    ];
    for (const input of nasty) {
      const segs = parseDraftSegments(input);
      if (segs) {
        expectNoRawMarkers(segs);
      } else {
        // Si no hay nada que mostrar, el barrido del fallback tampoco deja marcadores.
        expect(stripDraftMarkers(input)).not.toMatch(/<<<(?:DRAFT_START|DRAFT_END|WHATSAPP_TO:)/);
      }
    }
  });

  it("devuelve null si no hay marcadores (el mensaje normal no entra al camino de drafts)", () => {
    expect(parseDraftSegments("Hola, ¿cómo va? Te paso 3 propiedades.")).toBeNull();
  });
});

describe("stripAllMarkers (red final m6 + Copiar/Citar M2)", () => {
  it("barre marcadores de draft conocidos igual que stripDraftMarkers", () => {
    const raw = "hola <<<WHATSAPP_TO:+549351>>><<<DRAFT_START>>>texto<<<DRAFT_END>>> chau";
    expect(stripAllMarkers(raw)).toBe("hola texto chau");
  });

  it("barre marcadores genéricos/malformados que el parser no conoce", () => {
    expect(stripAllMarkers("a <<<PROPERTIES>>> b")).toBe("a  b");
    expect(stripAllMarkers("a <<<CONTACTS:xyz-1>>> b")).toBe("a  b");
    expect(stripAllMarkers("a <<<MARCADOR_RARO:con args {x:1}>>> b")).toBe("a  b");
    // Escenario M2: el content crudo de la burbuja no lleva NADA de <<<...>>> al portapapeles/[REFERENCIA].
    const bubble = "<<<WHATSAPP_TO:+5493511111111>>><<<DRAFT_START>>>Hola Juan!<<<DRAFT_END>>>";
    expect(stripAllMarkers(bubble)).not.toMatch(/<<<|>>>/);
    expect(stripAllMarkers(bubble)).toContain("Hola Juan!");
  });

  it("no toca texto legítimo con '<<<' que no es un marcador de protocolo", () => {
    expect(stripAllMarkers("matemática: a <<< b y c >>> d")).toBe("matemática: a <<< b y c >>> d");
    expect(stripAllMarkers("código: x <<<y>>> z")).toBe("código: x <<<y>>> z"); // minúsculas: no es protocolo
  });
});

describe("normalizeWhatsappNumber (m5: botón de WhatsApp solo con teléfono real)", () => {
  it("acepta números válidos, con o sin +, y limpia espacios/guiones/paréntesis", () => {
    expect(normalizeWhatsappNumber("+5493511234567")).toBe("+5493511234567");
    expect(normalizeWhatsappNumber("5493511234567")).toBe("5493511234567");
    expect(normalizeWhatsappNumber("+54 9 (351) 123-4567")).toBe("+5493511234567");
  });

  it("rechaza basura de mensajes viejos en DB (no numérico, corto, vacío)", () => {
    expect(normalizeWhatsappNumber("hola mundo")).toBeUndefined();
    expect(normalizeWhatsappNumber("+549abc123")).toBeUndefined();
    expect(normalizeWhatsappNumber("123")).toBeUndefined(); // < 8 dígitos
    expect(normalizeWhatsappNumber("12345678901234567890")).toBeUndefined(); // > 15 dígitos
    expect(normalizeWhatsappNumber("")).toBeUndefined();
    expect(normalizeWhatsappNumber(undefined)).toBeUndefined();
  });
});

describe("splitBubbles (paridad streaming vs recarga)", () => {
  /** Simula el camino de streaming: MarkerStream + la acumulación de use-chat-messages. */
  function streamBubbles(text: string, chunkSize = 7): string[] {
    const bubbles: string[] = [];
    let current = "";
    const ms = new MarkerStream(
      (t) => { current += t; },
      () => { bubbles.push(current); current = ""; },
    );
    for (let i = 0; i < text.length; i += chunkSize) ms.push(text.slice(i, i + chunkSize));
    ms.flush();
    bubbles.push(current);
    return bubbles.map((b) => b.trim()).filter(Boolean);
  }

  it("un MSG_BREAK dentro de un draft NO corta la burbuja (misma vista en vivo y al recargar)", () => {
    const text =
      `intro ${MSG_BREAK} <<<DRAFT_START>>>línea1 ${MSG_BREAK} línea2<<<DRAFT_END>>> cierre ${MSG_BREAK} final`;
    const reloaded = splitBubbles(text);
    expect(reloaded).toEqual(streamBubbles(text));
    expect(reloaded.length).toBe(3); // el MSG_BREAK del draft no cortó
    expect(reloaded[1]).toContain("<<<DRAFT_START>>>");
    expect(reloaded[1]).toContain("cierre");
  });

  it("paridad también con WHATSAPP_TO + draft sin cerrar al final", () => {
    const text = `aviso ${MSG_BREAK} <<<WHATSAPP_TO:+549351>>> <<<DRAFT_START>>>quedó ${MSG_BREAK} abierto`;
    expect(splitBubbles(text)).toEqual(streamBubbles(text));
  });

  it("split simple sin drafts se comporta como el split plano", () => {
    const text = `uno ${MSG_BREAK} dos ${MSG_BREAK} tres`;
    expect(splitBubbles(text)).toEqual(["uno", "dos", "tres"]);
    expect(splitBubbles(text)).toEqual(streamBubbles(text));
  });
});

describe("precedencia con property cards", () => {
  const twoCards =
    "Encontré 2 opciones:\n\n" +
    "🏠 **Casa en Argüello**\n💰 USD 120.000\n📍 Argüello, Córdoba\n📐 250 m²\n🔗 [Ver propiedad](https://www.remax.com.ar/listings/casa-x1)\n\n" +
    "🏠 **Depto en Nueva Córdoba**\n💰 USD 90.000\n📍 Nueva Córdoba\n📐 55 m²\n🔗 [Ver propiedad](https://www.remax.com.ar/listings/depto-x2)";

  it("property-cards reales sin drafts siguen dando multiCards (no las pisa el camino de drafts)", () => {
    expect(hasDraftMarkers(twoCards)).toBe(false);
    expect(parseDraftSegments(twoCards)).toBeNull();
    const segs = parseMultiplePropertyCards(twoCards)!;
    expect(segs.filter((s) => s.type === "property").length).toBe(2);
  });

  it("con ≥2 🏠 DENTRO de drafts, el gate hasDraftMarkers manda al camino de drafts", () => {
    const campaign =
      "<<<WHATSAPP_TO:+5491111111111>>> <<<DRAFT_START>>>Mirá esta 🏠 casa<<<DRAFT_END>>> " +
      "<<<WHATSAPP_TO:+5492222222222>>> <<<DRAFT_START>>>Y esta otra 🏠 también<<<DRAFT_END>>>";
    expect(hasDraftMarkers(campaign)).toBe(true); // ChatMessage no corre parseMultiplePropertyCards acá
    const segs = parseDraftSegments(campaign)!;
    expect(draftSegments(segs).length).toBe(2);
    expectNoRawMarkers(segs);
  });
});
