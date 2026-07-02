import { describe, it, expect } from "vitest";
import { normalizePhone, resolveUniqueClient, validateAndCorrectWhatsapp, whatsappNeutralizedNotice, verifyContactListPhones } from "./whatsapp-guardrail";

const CANON = "+5493511234567";

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

describe("validateAndCorrectWhatsapp", () => {
  const validPhones = new Set([CANON, "+5493519876543"]);
  const registry = [
    { name: "María González", phone: CANON },
    { name: "Roberto Aguilar", phone: "+5493519876543" },
  ];
  const draft = (n: string, body: string) => `<<<WHATSAPP_TO:${n}>>>\n<<<DRAFT_START>>>${body}<<<DRAFT_END>>>`;

  it("número REAL → marcador intacto (re-emitido canónico), 0 neutralizados/corregidos", () => {
    const r = validateAndCorrectWhatsapp(draft("351-123-4567", "Hola"), validPhones, registry);
    expect(r.neutralized).toBe(0);
    expect(r.corrected).toBe(0);
    expect(r.text).toContain(`<<<WHATSAPP_TO:${CANON}>>>`);
  });

  it("número INVENTADO sin nombre en el borrador → neutralizado (sin botón)", () => {
    const r = validateAndCorrectWhatsapp(draft("+5493519999999", "Hola, te escribo por una propiedad"), validPhones, registry);
    expect(r.neutralized).toBe(1);
    expect(r.corrected).toBe(0);
    expect(r.text).not.toContain("<<<WHATSAPP_TO:");
  });

  it("número INVENTADO pero el borrador nombra al cliente → CORREGIDO al número real", () => {
    const r = validateAndCorrectWhatsapp(draft("+5493519999999", "Hola María González, te comparto..."), validPhones, registry);
    expect(r.corrected).toBe(1);
    expect(r.neutralized).toBe(0);
    expect(r.text).toContain(`<<<WHATSAPP_TO:${CANON}>>>`);
    expect(r.text).not.toContain("9999999");
  });

  it("nombre ambiguo (dos con distinto teléfono, solo primer nombre) → no corrige, neutraliza", () => {
    const reg2 = [{ name: "Juan García", phone: "+5493511111111" }, { name: "Juan López", phone: "+5493512222222" }];
    const r = validateAndCorrectWhatsapp(draft("+5493519999999", "Hola Juan, cómo estás"), new Set(["+5493511111111", "+5493512222222"]), reg2);
    expect(r.corrected).toBe(0);
    expect(r.neutralized).toBe(1);
  });

  it("marcador con letras (apellido inventado en el número) → tratado inválido y removido", () => {
    const r = validateAndCorrectWhatsapp(draft("+549351Ana", "Hola"), validPhones, registry);
    expect(r.text).not.toContain("<<<WHATSAPP_TO:");
    expect(r.neutralized).toBe(1);
  });

  it("3 borradores [válido, inventado-corregible, inventado-no-corregible] → 1 intacto, 1 corregido, 1 neutralizado", () => {
    const txt =
      draft("+5493511234567", "Hola") + "\n" +
      draft("+5490000000000", "Hola Roberto Aguilar, te escribo") + "\n" +
      draft("+5490000000000", "Hola, mensaje generico");
    const r = validateAndCorrectWhatsapp(txt, validPhones, registry);
    expect(r.corrected).toBe(1);
    expect(r.neutralized).toBe(1);
    expect(r.text).toContain(`<<<WHATSAPP_TO:${CANON}>>>`);
    expect(r.text).toContain("<<<WHATSAPP_TO:+5493519876543>>>");
  });

  it("registro/valid vacíos → todo se neutraliza (fail-safe)", () => {
    const r = validateAndCorrectWhatsapp(draft("+5493511234567", "Hola"), new Set(), []);
    expect(r.neutralized).toBe(1);
    expect(r.text).not.toContain("<<<WHATSAPP_TO:");
  });

  it("sin marcadores → texto idéntico, no-op", () => {
    const t = "Listo, te dejo el dato.";
    const r = validateAndCorrectWhatsapp(t, validPhones, registry);
    expect(r.text).toBe(t);
    expect(r.neutralized).toBe(0);
  });
});

describe("resolveUniqueClient", () => {
  const reg = [{ name: "María González", phone: "+5493511111111" }, { name: "Pedro Martín", phone: "+5493512222222" }];
  it("match por primer nombre acentuado-insensible", () => {
    expect(resolveUniqueClient("Hola Maria, cómo va", reg)?.phone).toBe("+5493511111111");
  });
  it("sin match → null", () => {
    expect(resolveUniqueClient("Hola Juan", reg)).toBeNull();
  });
});

describe("whatsappNeutralizedNotice", () => {
  it("singular/plural y 0 → vacío", () => {
    expect(whatsappNeutralizedNotice(0)).toBe("");
    expect(whatsappNeutralizedNotice(1)).toContain("1 mensaje");
    expect(whatsappNeutralizedNotice(3)).toContain("3 mensajes");
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

  it("no toca el interior de un marcador WHATSAPP_TO", () => {
    const t = "<<<WHATSAPP_TO:+5493599999999>>>\nLista: +5493588888888, +5493577777777, +5493566666666";
    const r = verifyContactListPhones(t, agenda);
    expect(r.text).toContain("<<<WHATSAPP_TO:+5493599999999>>>"); // marcador intacto
    expect(r.text).toContain("+5493588888888 ⚠️");
  });
});
