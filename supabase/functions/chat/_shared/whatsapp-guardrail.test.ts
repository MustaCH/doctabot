import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  resolveUniqueClient,
  sanitizeWhatsappBlocks,
  extractGreetedName,
  whatsappNeutralizedNotice,
  whatsappRemovedNotice,
  whatsappCorrectedNotice,
  verifyContactListPhones,
  WhatsappBlockOptions,
} from "./whatsapp-guardrail";

const CANON = "+5493511234567";
const OTHER = "+5493519876543";

describe("normalizePhone — canónico E.164 AR de celular o null", () => {
  it("distintos formatos del MISMO número → mismo canónico", () => {
    for (const v of ["+5493511234567", "5493511234567", "+54 9 351 123-4567", "351-1234567", "3511234567", "03511234567", "9351 1234567", "+54 351 1234567", "\t+54 9 351 123 4567"]) {
      expect(normalizePhone(v)).toBe(CANON);
    }
  });
  it("Buenos Aires válido se conserva (no es solo Córdoba)", () => {
    expect(normalizePhone("+5491123456789")).toBe("+5491123456789");
  });
  it("parcial / junk / no-AR → null (conservador → se neutraliza)", () => {
    for (const v of ["", null, undefined, "+54351", "123", "María González", "+1 202 555 0147", "54000000", "abc"]) {
      expect(normalizePhone(v as any)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// sanitizeWhatsappBlocks — validación de BLOQUE completo (marcador + borrador)
// ---------------------------------------------------------------------------

const block = (n: string, body: string) => `<<<WHATSAPP_TO:${n}>>>\n<<<DRAFT_START>>>\n${body}\n<<<DRAFT_END>>>`;

const baseOpts = (over: Partial<WhatsappBlockOptions> = {}): WhatsappBlockOptions => ({
  validPhones: new Set([CANON, OTHER]),
  phoneOwners: new Map([[CANON, ["María González"]], [OTHER, ["Roberto Aguilar"]]]),
  registry: [
    { name: "María González", phone: CANON },
    { name: "Roberto Aguilar", phone: OTHER },
  ],
  toolVerified: true,
  seedPhones: new Set<string>(),
  ...over,
});

describe("sanitizeWhatsappBlocks", () => {
  it("caso legítimo (teléfono real + saludo al dueño) pasa intacto, marcador canónico", () => {
    const r = sanitizeWhatsappBlocks(block("351-123-4567", "Hola María González, te comparto una propiedad."), baseOpts());
    expect(r.blocksTotal).toBe(1);
    expect(r.blocksKept).toBe(1);
    expect(r.removedBlocks).toBe(0);
    expect(r.text).toContain(`<<<WHATSAPP_TO:${CANON}>>>`);
    expect(r.text).toContain("Hola María González");
  });

  it("saludo por primer nombre del dueño → tolerado (pasa)", () => {
    const r = sanitizeWhatsappBlocks(block(CANON, "Hola María, ¿cómo va?"), baseOpts());
    expect(r.blocksKept).toBe(1);
    expect(r.removedBlocks).toBe(0);
  });

  it("bloque INVENTADO (teléfono fuera de agenda + nombre desconocido) → eliminado ENTERO (marcador Y borrador)", () => {
    const r = sanitizeWhatsappBlocks(block("+5493519999999", "Hola Carlos Pérez, te escribo por una propiedad."), baseOpts());
    expect(r.removedBlocks).toBe(1);
    expect(r.blocksKept).toBe(0);
    expect(r.text).not.toContain("<<<WHATSAPP_TO:");
    expect(r.text).not.toContain("Carlos Pérez"); // el borrador con nombre inventado NO queda visible
    expect(r.text).not.toContain("<<<DRAFT_START>>>");
  });

  it("RECOMBINACIÓN nombre de cliente B + teléfono REAL de cliente A → eliminado entero (B2)", () => {
    // Teléfono real de Roberto, pero el borrador saluda a María (OTRO cliente conocido de la
    // agenda): evidencia de recombinación → bloque eliminado entero.
    const r = sanitizeWhatsappBlocks(block(OTHER, "Hola María González, tengo novedades para vos."), baseOpts());
    expect(r.removedBlocks).toBe(1);
    expect(r.blocksKept).toBe(0);
    expect(r.text).not.toContain("María González");
    expect(r.text).not.toContain(OTHER);
  });

  it("B2: saludo a nombre DESCONOCIDO (no matchea a ningún cliente) + teléfono real → PASA (el teléfono ya validó)", () => {
    const r = sanitizeWhatsappBlocks(block(OTHER, "Hola Juana López, tengo novedades para vos."), baseOpts());
    expect(r.removedBlocks).toBe(0);
    expect(r.blocksKept).toBe(1);
    expect(r.text).toContain(`<<<WHATSAPP_TO:${OTHER}>>>`);
  });

  // B2 — tabla de la review: prosa/apodos/saludos sin nombre NO eliminan borradores legítimos.
  it.each([
    ["Hola, espero que estés bien. Te comparto una propiedad."],
    ["Hola! Cómo estás. Te escribo por la propiedad de Alberdi."],
    ["Hola Sra. García, le comparto una propiedad."],
    ["Hola equipo, les paso las novedades de la semana."],
    ["Hola Beto, ¿cómo va? Te paso el dato."],
  ])("B2: borrador legítimo con saludo no-canónico pasa intacto: %s", (body) => {
    const r = sanitizeWhatsappBlocks(block(CANON, body), baseOpts());
    expect(r.blocksKept).toBe(1);
    expect(r.removedBlocks).toBe(0);
    expect(r.text).toContain(`<<<WHATSAPP_TO:${CANON}>>>`);
  });

  it("teléfono inventado pero el cuerpo nombra COMPLETO a un cliente del turno → corregido y conservado", () => {
    const r = sanitizeWhatsappBlocks(block("+5490000000000", "Hola María González, te comparto novedades."), baseOpts());
    expect(r.corrected).toBe(1);
    expect(r.blocksKept).toBe(1);
    expect(r.text).toContain(`<<<WHATSAPP_TO:${CANON}>>>`);
    expect(r.text).not.toContain("0000000000");
  });

  it("primer nombre suelto YA NO corrige (recombinación bloqueada) → bloque eliminado", () => {
    const r = sanitizeWhatsappBlocks(block("+5490000000000", "Hola María, te comparto novedades."), baseOpts());
    expect(r.corrected).toBe(0);
    expect(r.removedBlocks).toBe(1);
    expect(r.text).not.toContain("<<<WHATSAPP_TO:");
  });

  it("gate estructural: sin list_clients/get_client en el turno → bloques eliminados aunque el teléfono sea real", () => {
    const r = sanitizeWhatsappBlocks(block(CANON, "Hola María González, ¿cómo va?"), baseOpts({ toolVerified: false }));
    expect(r.removedBlocks).toBe(1);
    expect(r.text).not.toContain("<<<WHATSAPP_TO:");
  });

  it("gate estructural: el cliente ACTIVO sembrado pasa sin tool en el turno", () => {
    const r = sanitizeWhatsappBlocks(
      block(CANON, "Hola María González, ¿cómo va?"),
      baseOpts({ toolVerified: false, seedPhones: new Set([CANON]) }),
    );
    expect(r.blocksKept).toBe(1);
    expect(r.removedBlocks).toBe(0);
    expect(r.text).toContain(`<<<WHATSAPP_TO:${CANON}>>>`);
  });

  it("tanda mixta: [legítimo, inventado, recombinación] → 1 conservado, 2 eliminados enteros", () => {
    const txt = [
      block(CANON, "Hola María González, novedades."),
      block("+5490000000000", "Hola Pedro Ramírez, novedades."),
      block(OTHER, "Hola María González, novedades."), // nombre de María con el teléfono de Roberto
    ].join("\n===MSG_BREAK===\n");
    const r = sanitizeWhatsappBlocks(txt, baseOpts());
    expect(r.blocksTotal).toBe(3);
    expect(r.blocksKept).toBe(1);
    expect(r.removedBlocks).toBe(2);
    expect(r.text).toContain(`<<<WHATSAPP_TO:${CANON}>>>`);
    expect(r.text).not.toContain(OTHER);
    expect(r.text).not.toContain("Pedro Ramírez");
  });

  it("marcador SUELTO (sin borrador) no verificable → se quita solo el marcador (neutralizedMarkers)", () => {
    const r = sanitizeWhatsappBlocks("<<<WHATSAPP_TO:+5493519999999>>>\nTexto normal que sigue.", baseOpts());
    expect(r.neutralizedMarkers).toBe(1);
    expect(r.blocksTotal).toBe(0);
    expect(r.text).toContain("Texto normal que sigue.");
    expect(r.text).not.toContain("<<<WHATSAPP_TO:");
  });

  it("B3: teléfono TIPEADO por el agente (en seedPhones) pasa el gate SIN tool de contactos en el turno", () => {
    // Regresión: el gate estructural mataba "escribile al 3511234567" cuando list_clients/get_client
    // no corrió en el turno — el teléfono lo puso el agente (index.ts lo suma a seedPhones).
    const typed = "+5493515555555";
    const r = sanitizeWhatsappBlocks(
      block(typed, "Hola Nuevo Lead, te escribo por la propiedad."),
      baseOpts({ validPhones: new Set([typed]), phoneOwners: new Map(), registry: [], toolVerified: false, seedPhones: new Set([typed]) }),
    );
    expect(r.blocksKept).toBe(1);
    expect(r.removedBlocks).toBe(0);
    expect(r.text).toContain(`<<<WHATSAPP_TO:${typed}>>>`);
  });

  it("M4: texto intercalado entre marcador y borrador NO esquiva la validación (bloque inventado eliminado ENTERO)", () => {
    const t = `<<<WHATSAPP_TO:+5493519999999>>>\nPara el cliente:\n<<<DRAFT_START>>>\nHola Carlos Pérez, te escribo por una propiedad.\n<<<DRAFT_END>>>`;
    const r = sanitizeWhatsappBlocks(t, baseOpts());
    expect(r.blocksTotal).toBe(1);
    expect(r.removedBlocks).toBe(1);
    expect(r.text).not.toContain("Carlos Pérez");
    expect(r.text).not.toContain("<<<DRAFT_START>>>");
  });

  it("M4: el texto intercalado se CONSERVA cuando el bloque es válido", () => {
    const t = `<<<WHATSAPP_TO:${CANON}>>>\nPara María:\n<<<DRAFT_START>>>\nHola María González, novedades.\n<<<DRAFT_END>>>`;
    const r = sanitizeWhatsappBlocks(t, baseOpts());
    expect(r.blocksKept).toBe(1);
    expect(r.text).toContain("Para María:");
    expect(r.text).toContain(`<<<WHATSAPP_TO:${CANON}>>>`);
  });

  it("sin marcadores → no-op", () => {
    const t = "Listo, te dejo el dato.";
    const r = sanitizeWhatsappBlocks(t, baseOpts());
    expect(r.text).toBe(t);
    expect(r.blocksTotal).toBe(0);
  });
});

describe("extractGreetedName", () => {
  it("extrae el nombre saludado, folded", () => {
    expect(extractGreetedName("Hola María González, te escribo")).toBe("maria gonzalez");
    expect(extractGreetedName("¡Hola Roberto! ¿Cómo va?")).toBe("roberto");
    expect(extractGreetedName("Buenas tardes Ana Ruiz:")).toBe("ana ruiz");
  });
  it("sin saludo reconocible → null", () => {
    expect(extractGreetedName("Te paso el link de la propiedad")).toBeNull();
    expect(extractGreetedName("")).toBeNull();
  });
  it("B2: prosa tras el saludo NO es un nombre (stop-list + tope de 3 palabras)", () => {
    expect(extractGreetedName("Hola, espero que estés bien. Te escribo")).toBeNull();
    expect(extractGreetedName("Hola! Cómo estás.")).toBeNull();
    expect(extractGreetedName("Hola Sra. García, le escribo")).toBeNull();
    expect(extractGreetedName("Hola equipo, novedades")).toBeNull();
    expect(extractGreetedName("Hola querida amiga de toda la vida, te escribo")).toBeNull(); // 4+ palabras
  });
  it("B2: un apodo corto sí se captura (después no matchea a nadie y el bloque pasa)", () => {
    expect(extractGreetedName("Hola Beto, ¿cómo va?")).toBe("beto");
  });
});

describe("resolveUniqueClient — exige nombre COMPLETO", () => {
  const reg = [{ name: "María González", phone: "+5493511111111" }, { name: "Pedro Martín", phone: "+5493512222222" }];
  it("match por nombre completo, acento/case-insensible", () => {
    expect(resolveUniqueClient("Hola Maria Gonzalez, cómo va", reg)?.phone).toBe("+5493511111111");
  });
  it("primer nombre suelto NO resuelve (antes recombinaba teléfonos ajenos)", () => {
    expect(resolveUniqueClient("Hola Maria, cómo va", reg)).toBeNull();
  });
  it("nombre parcial dentro de otro nombre NO matchea ('Ana' no es 'Susana Pérez')", () => {
    expect(resolveUniqueClient("Hola Ana", [{ name: "Susana Pérez", phone: "+5493511111111" }])).toBeNull();
  });
  it("sin match → null", () => {
    expect(resolveUniqueClient("Hola Juan Gómez", reg)).toBeNull();
  });
});

describe("avisos", () => {
  it("whatsappNeutralizedNotice: singular/plural y 0 → vacío", () => {
    expect(whatsappNeutralizedNotice(0)).toBe("");
    expect(whatsappNeutralizedNotice(1)).toContain("1 mensaje");
    expect(whatsappNeutralizedNotice(3)).toContain("3 mensajes");
  });
  it("whatsappRemovedNotice: honesto sobre el origen del error", () => {
    expect(whatsappRemovedNotice(0)).toBe("");
    expect(whatsappRemovedNotice(2)).toContain("Eliminé 2");
    expect(whatsappRemovedNotice(2)).toContain("NO figuran");
    expect(whatsappRemovedNotice(2)).toContain("list_clients");
  });
  it("whatsappCorrectedNotice: visible al usuario", () => {
    expect(whatsappCorrectedNotice(0)).toBe("");
    expect(whatsappCorrectedNotice(1)).toContain("Corregí el teléfono de 1 borrador");
  });
});

describe("verifyContactListPhones — listas de contactos fabricadas (86ajbr466)", () => {
  const agenda = new Set(["+5493511111111", "+5493512222222", "+5493513333333"]);

  it("lista REAL (todos en agenda) pasa intacta", () => {
    const t = "1. Ana +5493511111111\n2. Luis +5493512222222\n3. Marta +5493513333333";
    const r = verifyContactListPhones(t, agenda);
    expect(r.flagged).toBe(0);
    expect(r.text).toBe(t);
  });

  it("lista FABRICADA (3+ desconocidos) marca cada número y anexa aviso", () => {
    const t = "1. Lucas +5493572582630\n2. Ruth +5493572570959\n3. Anto +5493572525150\n4. Ana +5493511111111";
    const r = verifyContactListPhones(t, agenda);
    expect(r.flagged).toBe(3);
    expect(r.text).toContain("+5493572582630 ⚠️");
    expect(r.text).toContain("+5493572570959 ⚠️");
    expect(r.text).not.toContain("+5493511111111 ⚠️"); // el real no se marca
    expect(r.text).toContain("NO figuran en tu agenda");
  });

  it("1-2 desconocidos NO gatillan (evita falsos positivos)", () => {
    const t = "Ana +5493511111111 y un nuevo +5493599999999";
    const r = verifyContactListPhones(t, agenda);
    expect(r.flagged).toBe(0);
    expect(r.text).toBe(t);
  });

  it("precios/conteos/superficies no cuentan como teléfonos", () => {
    const t = "💰 Precio: USD 129000\nExpensas: $1350000 ARS/mes\n📐 78 m² — total 1124 clientes";
    const r = verifyContactListPhones(t, agenda);
    expect(r.totalPhones).toBe(0);
    expect(r.text).toBe(t);
  });

  it("teléfonos DENTRO de marcadores cuentan para el umbral, pero el marcador no se anota inline", () => {
    // 3 borradores falsos: los números viven solo dentro de los marcadores → antes el umbral no
    // se disparaba (los excluía del conteo). Ahora cuentan; el interior sigue sin ⚠️.
    const t = "<<<WHATSAPP_TO:+5493588888888>>>\n<<<WHATSAPP_TO:+5493577777777>>>\n<<<WHATSAPP_TO:+5493566666666>>>";
    const r = verifyContactListPhones(t, agenda);
    expect(r.totalPhones).toBe(3);
    expect(r.flagged).toBe(3);
    expect(r.text).toContain("<<<WHATSAPP_TO:+5493588888888>>>"); // marcador intacto (sin ⚠️ adentro)
    expect(r.text).not.toContain("+5493588888888 ⚠️");
    expect(r.text).toContain("NO figuran en tu agenda");
  });

  it("mezcla marcador + lista: el desconocido del marcador suma al umbral y solo la lista se anota", () => {
    const t = "<<<WHATSAPP_TO:+5493599999999>>>\nLista: +5493588888888, +5493577777777";
    const r = verifyContactListPhones(t, agenda);
    expect(r.flagged).toBe(3);
    expect(r.text).toContain("<<<WHATSAPP_TO:+5493599999999>>>"); // marcador intacto
    expect(r.text).toContain("+5493588888888 ⚠️");
  });

  it("m6: el umbral se calcula sobre el texto PRE-saneo — los bloques eliminados cuentan y los números visibles se anotan", () => {
    // Pre-saneo: 2 desconocidos en lista + 2 en marcadores (4 ≥ 3 → dispara). Post-saneo: los
    // marcadores fueron eliminados; quedan 2 en lista, que ANTES no llegaban al umbral solos.
    const pre = "<<<WHATSAPP_TO:+5493599999999>>>\n<<<WHATSAPP_TO:+5493598888888>>>\nLista: +5493588888888, +5493577777777";
    const post = "Lista: +5493588888888, +5493577777777";
    const r = verifyContactListPhones(post, agenda, pre);
    expect(r.flagged).toBe(2); // los VISIBLES anotados
    expect(r.text).toContain("+5493588888888 ⚠️");
    expect(r.text).toContain("+5493577777777 ⚠️");
    expect(r.text).toContain("2 de los 2 teléfonos");
  });

  it("m6: si el saneo ya eliminó a TODOS los infractores, no se anota ni se anexa aviso (lo cubre el aviso de bloques)", () => {
    const pre = "<<<WHATSAPP_TO:+5493599999999>>>\n<<<WHATSAPP_TO:+5493598888888>>>\n<<<WHATSAPP_TO:+5493597777777>>>";
    const post = "Te dejo las novedades de tus clientes: Ana +5493511111111.";
    const r = verifyContactListPhones(post, agenda, pre);
    expect(r.flagged).toBe(0);
    expect(r.text).toBe(post);
  });
});
