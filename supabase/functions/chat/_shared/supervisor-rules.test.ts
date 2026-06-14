import { describe, it, expect } from "vitest";
import { unactedReadVerdict, buildPriorContextBlock } from "./supervisor-rules";

describe("unactedReadVerdict", () => {
  it("pedido de listar clientes SIN ejecutar la tool → rejected con category accion_no_ejecutada", () => {
    const v = unactedReadVerdict("listame mis clientes", []);
    expect(v?.verdict).toBe("rejected");
    expect(v?.reason).toMatch(/list_clients/);
    expect(v?.category).toBe("accion_no_ejecutada");
  });

  it("pedido de listar clientes CON la tool ejecutada → null (sigue eval normal)", () => {
    expect(unactedReadVerdict("listame mis clientes", ["list_clients"])).toBeNull();
    // get_client también satisface la intención
    expect(unactedReadVerdict("mostrame el cliente María", ["get_client"])).toBeNull();
  });

  it("pedido de buscar propiedades sin search → rejected", () => {
    const v = unactedReadVerdict("buscá departamentos en Nueva Córdoba", []);
    expect(v?.verdict).toBe("rejected");
    expect(v?.reason).toMatch(/search_properties/);
  });

  it("búsqueda satisfecha por portales externos → null", () => {
    expect(unactedReadVerdict("buscá deptos en zonaprop", ["search_external_portals"])).toBeNull();
  });

  it("ver favoritos / agenda sin tool → rejected", () => {
    expect(unactedReadVerdict("mostrame mis favoritos", [])?.verdict).toBe("rejected");
    expect(unactedReadVerdict("qué tengo mañana", [])?.verdict).toBe("rejected");
  });

  it("mensajes que NO son pedidos de lectura → null (no rechaza)", () => {
    expect(unactedReadVerdict("sí, dale, mandáselo", [])).toBeNull();
    expect(unactedReadVerdict("redactá un email para María", [])).toBeNull();
    expect(unactedReadVerdict("hola, cómo va", [])).toBeNull();
    expect(unactedReadVerdict("gracias!", [])).toBeNull();
  });
});

describe("buildPriorContextBlock", () => {
  it("sin contexto previo devuelve string vacío", () => {
    expect(buildPriorContextBlock(null)).toBe("");
    expect(buildPriorContextBlock(undefined)).toBe("");
    expect(buildPriorContextBlock({})).toBe("");
    expect(buildPriorContextBlock({ user: "", assistant: "" })).toBe("");
  });

  it("con turno anterior antepone el bloque CONTEXTO PREVIO", () => {
    const block = buildPriorContextBlock({ user: "te paso el depto de Manantiales", assistant: "Listo, ¿lo mando por WhatsApp?" });
    expect(block).toContain("CONTEXTO PREVIO");
    expect(block).toContain("Manantiales");
    expect(block).toContain("WhatsApp");
  });

  it("incluye solo el lado presente", () => {
    const block = buildPriorContextBlock({ assistant: "¿Lo envío?" });
    expect(block).toContain("CONTEXTO PREVIO");
    expect(block).toContain("¿Lo envío?");
    expect(block).not.toContain("Usuario (anterior)");
  });
});
