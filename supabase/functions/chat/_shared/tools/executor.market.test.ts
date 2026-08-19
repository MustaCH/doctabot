// Tests de contrato de market_stats / negotiation_brief (ticket 86aj9w5pv) contra el mock
// in-memory de evals (mismo patrón de query-builder que PostgREST).
import { describe, it, expect } from "vitest";
import { executeTool } from "./executor";
import { createMockDb, mockSupabase } from "../evals/mock-db";

const USER = "00000000-0000-4000-8000-00000000e0a1";
const OTHER_USER = "00000000-0000-4000-8000-00000000e0a2";
const CLIENT_ID = "11111111-1111-4111-8111-000000000001";
const PROP_ID = "22222222-2222-4222-8222-000000000001";

function seedDb() {
  return createMockDb({
    properties: [
      { id: PROP_ID, title: "Depto 2 dorm Nueva Córdoba", zone: "nueva cordoba", operation: "Venta", property_type: "Departamento", price: 130000, currency: "USD", m2_total: 100, listing_status: "active", created_at: "2026-07-20T00:00:00Z", url: "https://www.remax.com.ar/listings/x", photo: "p.jpg", photos: ["p.jpg"] },
      { id: "22222222-2222-4222-8222-000000000002", title: "Depto 1 dorm NC", zone: "nueva cordoba", operation: "Venta", property_type: "Departamento", price: 100000, currency: "USD", m2_total: 100, listing_status: "active", created_at: "2026-08-01T00:00:00Z" },
      { id: "22222222-2222-4222-8222-000000000003", title: "Depto 3 dorm NC", zone: "nueva cordoba", operation: "Venta", property_type: "Departamento", price: 120000, currency: "USD", m2_total: 100, listing_status: "active", created_at: "2026-08-10T00:00:00Z" },
      // Baja: no debe entrar en las stats (only active o NULL legacy).
      { id: "22222222-2222-4222-8222-000000000004", title: "Depto dado de baja", zone: "nueva cordoba", operation: "Venta", property_type: "Departamento", price: 999999, currency: "USD", m2_total: 100, listing_status: "inactive", created_at: "2026-01-01T00:00:00Z" },
      // Otra zona: fuera de los filtros.
      { id: "22222222-2222-4222-8222-000000000005", title: "Casa Manantiales", zone: "manantiales", operation: "Venta", property_type: "Casa", price: 185000, currency: "USD", m2_total: 180, listing_status: "active", created_at: "2026-08-03T00:00:00Z" },
    ],
    clients: [
      { id: CLIENT_ID, user_id: USER, full_name: "Ana Pérez", is_client: true, status: "hot", client_type: "buyer", budget_min: null, budget_max: 120000, budget_currency: "USD", preferred_zones: "Nueva Córdoba", property_type_interest: "departamento" },
      { id: "11111111-1111-4111-8111-000000000009", user_id: OTHER_USER, full_name: "Cliente Ajeno", is_client: true, status: "warm", client_type: "buyer" },
    ],
    client_properties: [
      { id: "33333333-3333-4333-8333-000000000001", user_id: USER, client_id: CLIENT_ID, property_id: "22222222-2222-4222-8222-000000000002", status: "descartada", notes: "muy chico", created_at: "2026-08-05T00:00:00Z" },
      { id: "33333333-3333-4333-8333-000000000002", user_id: USER, client_id: CLIENT_ID, property_id: "22222222-2222-4222-8222-000000000003", status: "visitada", notes: null, created_at: "2026-08-12T00:00:00Z" },
    ],
  });
}

function ctx(db = seedDb()) {
  return { supabase: mockSupabase(db), userId: USER, conversationId: "c1", getCalendarToken: async () => null };
}

describe("market_stats", () => {
  it("calcula stats REALES filtrando por zona/tipo/operación y excluye las dadas de baja", async () => {
    const res = JSON.parse(await executeTool("market_stats", { zone: "Nueva Córdoba", property_type: "Departamento", operation: "Venta" }, ctx()));
    expect(res.sample).toBe(3); // la inactive (999999) quedó afuera
    expect(res.by_currency[0].currency).toBe("USD");
    expect(res.by_currency[0].median_price).toBe(120000);
    expect(res.by_currency[0].price_per_m2?.median).toBe(1200);
    expect(res.filters).toEqual({ zone: "Nueva Cordoba", property_type: "Departamento", operation: "Venta" });
    expect(res.instruction).toMatch(/muestra/i);
  });

  it("sin zona ni tipo devuelve error de validación (no escanea toda la base)", async () => {
    const res = JSON.parse(await executeTool("market_stats", {}, ctx()));
    expect(res.error).toMatch(/zona o un tipo/i);
  });

  it("0 resultados: mensaje honesto, sin números inventados", async () => {
    const res = JSON.parse(await executeTool("market_stats", { zone: "Barrio Inexistente" }, ctx()));
    expect(res.sample).toBe(0);
    expect(res.message).toMatch(/no se pueden calcular/i);
    expect(res.by_currency).toBeUndefined();
  });
});

describe("negotiation_brief", () => {
  it("brief con comps (excluye la propiedad target), posición vs mediana y contexto del cliente scopeado", async () => {
    const res = JSON.parse(await executeTool("negotiation_brief", { property_id: PROP_ID, client_id: CLIENT_ID }, ctx()));
    expect(res.property.id).toBe(PROP_ID);
    // El brief no filtra material de links al modelo.
    expect(res.property.url).toBeUndefined();
    expect(res.property.photo).toBeUndefined();
    // Comps: los otros 2 deptos activos de la zona (target y baja excluidos).
    expect(res.market.comps_sample).toBe(2);
    // Target 130k vs mediana de comps 110k → +18.18%.
    expect(res.price_vs_median_pct).toBeCloseTo(18.18, 1);
    expect(res.client.full_name).toBe("Ana Pérez");
    expect(res.client.budget.max).toBe(120000);
    expect(res.client.descartadas).toEqual([
      { title: "Depto 1 dorm NC", price: 100000, currency: "USD", zone: "nueva cordoba", notes: "muy chico" },
    ]);
    expect(res.client.visitadas).toHaveLength(1);
    expect(typeof res.days_on_market).toBe("number");
  });

  it("resuelve la propiedad por título cuando no hay ID", async () => {
    const res = JSON.parse(await executeTool("negotiation_brief", { property_title: "Casa Manantiales" }, ctx()));
    expect(res.property.title).toBe("Casa Manantiales");
    expect(res.client).toBeNull();
  });

  it("cliente de OTRO agente: no filtra datos cross-tenant", async () => {
    const res = JSON.parse(await executeTool("negotiation_brief", { property_id: PROP_ID, client_id: "11111111-1111-4111-8111-000000000009" }, ctx()));
    expect(res.error).toMatch(/no encontrado|no te pertenece/i);
  });

  it("propiedad inexistente: error claro para re-buscar", async () => {
    const res = JSON.parse(await executeTool("negotiation_brief", { property_id: "22222222-2222-4222-8222-000000000099" }, ctx()));
    expect(res.error).toMatch(/ya no está publicada/i);
  });
});
