// Tests de contrato de recall_client_history (ticket 86aj9w5nu) contra el mock in-memory.
import { describe, it, expect } from "vitest";
import { executeTool } from "./executor";
import { createMockDb, mockSupabase } from "../evals/mock-db";

const USER = "00000000-0000-4000-8000-00000000e0a1";
const OTHER = "00000000-0000-4000-8000-00000000e0a2";
const ANA = "11111111-1111-4111-8111-000000000001";

function seedDb() {
  return createMockDb({
    clients: [
      { id: ANA, user_id: USER, full_name: "Ana Pérez", is_client: true, status: "hot", client_type: "buyer", phone: "+5493511111111", email: "ana@mail.com", ai_summary: "Busca depto 2 dorm en Nueva Córdoba; descartó el de Güemes por oscuro; quedamos en visitar el viernes.", ai_summary_updated_at: "2026-08-18T12:00:00Z" },
      { id: "11111111-1111-4111-8111-000000000002", user_id: USER, full_name: "Pedro Pérez", is_client: true, status: "warm", client_type: "buyer" },
      { id: "11111111-1111-4111-8111-000000000009", user_id: OTHER, full_name: "Cliente Ajeno", is_client: true, status: "warm", client_type: "buyer", ai_summary: "secreto de otro agente" },
      { id: "11111111-1111-4111-8111-000000000003", user_id: USER, full_name: "Marta Sin Historia", is_client: true, status: "cold", client_type: "both", ai_summary: null },
    ],
    client_notes: [
      { user_id: USER, client_id: ANA, content: "quiere balcón", is_action: false, is_done: false, created_at: "2026-08-15T00:00:00Z" },
    ],
    client_properties: [
      { user_id: USER, client_id: ANA, property_id: "22222222-2222-4222-8222-000000000001", status: "descartada", notes: "oscuro", created_at: "2026-08-14T00:00:00Z" },
    ],
    properties: [
      { id: "22222222-2222-4222-8222-000000000001", title: "Depto Güemes", price: 90000, currency: "USD", zone: "guemes", operation: "Venta" },
    ],
  });
}

const ctx = () => ({ supabase: mockSupabase(seedDb()), userId: USER, conversationId: "c1", getCalendarToken: async () => null });

describe("recall_client_history", () => {
  it("resuelve por nombre y devuelve memoria + notas + propiedades por estado", async () => {
    const res = JSON.parse(await executeTool("recall_client_history", { client_name: "Ana" }, ctx()));
    expect(res.client.full_name).toBe("Ana Pérez");
    expect(res.memoria).toMatch(/visitar el viernes/);
    expect(res.memoria_actualizada).toBe("2026-08-18T12:00:00Z");
    expect(res.notas_recientes).toHaveLength(1);
    expect(res.propiedades_vinculadas).toEqual([
      { status: "descartada", title: "Depto Güemes", price: 90000, currency: "USD", zone: "guemes", notes: "oscuro" },
    ]);
    expect(res.instruction).toMatch(/no lo inventes/i);
  });

  it("apellido ambiguo: pide desambiguar, no adivina", async () => {
    const res = JSON.parse(await executeTool("recall_client_history", { client_name: "Pérez" }, ctx()));
    expect(res.error).toMatch(/2 clientes/);
    expect(res.clients).toHaveLength(2);
  });

  it("cliente de OTRO agente por id: no filtra la memoria cross-tenant", async () => {
    const res = JSON.parse(await executeTool("recall_client_history", { client_id: "11111111-1111-4111-8111-000000000009" }, ctx()));
    expect(res.error).toMatch(/no encontrado|no te pertenece/i);
    expect(JSON.stringify(res)).not.toContain("secreto");
  });

  it("cliente sin memoria: memoria null (el prompt exige decirlo, no inventarlo)", async () => {
    const res = JSON.parse(await executeTool("recall_client_history", { client_name: "Marta" }, ctx()));
    expect(res.memoria).toBeNull();
    expect(res.client.full_name).toBe("Marta Sin Historia");
  });

  it("sin nombre ni id: error de validación", async () => {
    const res = JSON.parse(await executeTool("recall_client_history", {}, ctx()));
    expect(res.error).toMatch(/nombre o ID/);
  });
});
