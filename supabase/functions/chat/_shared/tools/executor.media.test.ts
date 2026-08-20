// Tests de contrato de analyze_property_media / extract_document (ticket 86aj9w5pp).
import { describe, it, expect } from "vitest";
import { executeTool } from "./executor";
import { createMockDb, mockSupabase, type MockDb } from "../evals/mock-db";

const USER = "00000000-0000-4000-8000-00000000e0a1";
const OTHER = "00000000-0000-4000-8000-00000000e0a2";
const ANA = "11111111-1111-4111-8111-000000000001";
const PROP = "22222222-2222-4222-8222-000000000001";

function seedDb(): MockDb {
  return createMockDb({
    clients: [
      { id: ANA, user_id: USER, full_name: "Ana Pérez", is_client: true, status: "hot", client_type: "buyer" },
      { id: "11111111-1111-4111-8111-000000000009", user_id: OTHER, full_name: "Cliente Ajeno", is_client: true, status: "warm", client_type: "buyer" },
    ],
    properties: [{ id: PROP, title: "Depto Güemes", zone: "guemes", operation: "Venta", listing_status: "active" }],
    media_analyses: [],
  });
}

const ctx = (db: MockDb) => ({ supabase: mockSupabase(db), userId: USER, conversationId: "c1", getCalendarToken: async () => null });

describe("analyze_property_media", () => {
  it("valida, persiste y devuelve el análisis tipado (vinculado a cliente por nombre y propiedad por id)", async () => {
    const db = seedDb();
    const res = JSON.parse(await executeTool("analyze_property_media", {
      tipo_espacio: "living",
      ambientes: 3,
      dormitorios: 2,
      estado_general: "Muy Bueno",
      features: ["balcón", "luz natural", "  "],
      observaciones: "humedad leve en pared norte",
      client_name: "Ana",
      property_id: PROP,
      source_label: "foto living",
    }, ctx(db)));
    expect(res.success).toBe(true);
    expect(res.linked_client).toBe(true);
    expect(res.linked_property).toBe(true);
    expect(res.analysis.estado_general).toBe("muy bueno"); // enum normalizado
    expect(res.analysis.features).toEqual(["balcón", "luz natural"]);
    const row = db.tables.media_analyses[0];
    expect(row.user_id).toBe(USER);
    expect(row.kind).toBe("property_media");
    expect(row.client_id).toBe(ANA);
    expect(row.property_id).toBe(PROP);
    expect(row.analysis.dormitorios).toBe(2);
  });

  it("estado_general fuera del enum se anula y queda registrado el valor inválido", async () => {
    const db = seedDb();
    const res = JSON.parse(await executeTool("analyze_property_media", { estado_general: "espectacular", observaciones: "linda vista" }, ctx(db)));
    expect(res.analysis.estado_general).toBeNull();
    expect(res.analysis.estado_general_invalido).toBe("espectacular");
  });

  it("análisis vacío: error que exige mirar la imagen, sin persistir", async () => {
    const db = seedDb();
    const res = JSON.parse(await executeTool("analyze_property_media", {}, ctx(db)));
    expect(res.error).toMatch(/no inventes/i);
    expect(db.tables.media_analyses).toHaveLength(0);
  });

  it("client_id de OTRO agente: rechaza sin persistir (cross-tenant)", async () => {
    const db = seedDb();
    const res = JSON.parse(await executeTool("analyze_property_media", { observaciones: "x", client_id: "11111111-1111-4111-8111-000000000009" }, ctx(db)));
    expect(res.error).toMatch(/no encontrado|no te pertenece/i);
    expect(db.tables.media_analyses).toHaveLength(0);
  });
});

describe("extract_document", () => {
  it("valida, persiste y tipa montos/fechas (descarta entradas malformadas)", async () => {
    const db = seedDb();
    const res = JSON.parse(await executeTool("extract_document", {
      doc_type: "boleto",
      partes: ["Juan Gómez (vendedor)", "Ana Pérez (compradora)"],
      montos: [
        { concepto: "precio total", valor: 120000, moneda: "USD" },
        { concepto: "sin valor numérico", valor: "ciento veinte" },
      ],
      fechas: [{ concepto: "escrituración", fecha: "2026-10-15" }, { sin_fecha: true }],
      direccion: "Bv. Illia 400",
      client_name: "Ana",
      source_label: "boleto depto",
    }, ctx(db)));
    expect(res.success).toBe(true);
    expect(res.analysis.montos).toEqual([{ concepto: "precio total", valor: 120000, moneda: "USD" }]);
    expect(res.analysis.fechas).toEqual([{ concepto: "escrituración", fecha: "2026-10-15" }]);
    const row = db.tables.media_analyses[0];
    expect(row.kind).toBe("document");
    expect(row.doc_type).toBe("boleto");
    expect(row.client_id).toBe(ANA);
    expect(res.instruction).toMatch(/escribano/i);
  });

  it("doc_type desconocido cae a 'otro'", async () => {
    const db = seedDb();
    const res = JSON.parse(await executeTool("extract_document", { doc_type: "factura", observaciones: "expensas enero" }, ctx(db)));
    expect(res.analysis.doc_type).toBe("otro");
  });

  it("extracción vacía: error que exige leer el documento, sin persistir", async () => {
    const db = seedDb();
    const res = JSON.parse(await executeTool("extract_document", { doc_type: "boleto" }, ctx(db)));
    expect(res.error).toMatch(/leé el documento/i);
    expect(db.tables.media_analyses).toHaveLength(0);
  });
});
