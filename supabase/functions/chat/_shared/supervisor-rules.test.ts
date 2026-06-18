import { describe, it, expect } from "vitest";
import { unactedReadVerdict, unexecutedWriteVerdict, buildPriorContextBlock } from "./supervisor-rules";

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

describe("unexecutedWriteVerdict", () => {
  it("afirma guardar una propiedad SIN ejecutar save_property_to_client → rejected (guardado fantasma)", () => {
    const v = unexecutedWriteVerdict("Listo, guardé la propiedad en el perfil de Armando.", []);
    expect(v?.verdict).toBe("rejected");
    expect(v?.category).toBe("accion_no_ejecutada");
    expect(v?.reason).toMatch(/save_property_to_client/);
  });

  it("afirma guardar/vincular CON la tool ejecutada → null", () => {
    expect(unexecutedWriteVerdict("Listo, guardé la propiedad al cliente.", ["save_property_to_client"])).toBeNull();
    expect(unexecutedWriteVerdict("Ya vinculé la conversación a su perfil.", ["link_conversation"])).toBeNull();
  });

  it("afirma vincular / enviar email sin la tool → rejected", () => {
    expect(unexecutedWriteVerdict("Ya vinculé la conversación a su perfil.", [])?.verdict).toBe("rejected");
    expect(unexecutedWriteVerdict("Listo, envié el email al cliente.", [])?.verdict).toBe("rejected");
  });

  it("ofertas y respuestas informativas NO se marcan (precisión > recall)", () => {
    // Subjuntivo/oferta, no afirmación de acción hecha.
    expect(unexecutedWriteVerdict("¿Querés que guarde la propiedad en su perfil?", [])).toBeNull();
    expect(unexecutedWriteVerdict("Puedo vincular la conversación si querés.", [])).toBeNull();
    // Informativa pura.
    expect(unexecutedWriteVerdict("Encontré 3 propiedades en Centro.", [])).toBeNull();
  });

  // Regresión 86aj42cb2: Alan dice que una BÚSQUEDA/propiedades "quedaron registradas al perfil"
  // pero solo corrió link_conversation (que vincula la CONVERSACIÓN, no guarda propiedades). El
  // claim de link_conversation es literalmente cierto pero engañoso. Requiere save_property_to_client.
  it("afirma que la búsqueda/propiedades quedaron en el perfil pero solo vinculó la conversación → rejected (save_property_to_client)", () => {
    const v = unexecutedWriteVerdict(
      "Listo, vinculé esta búsqueda al perfil de Armando para que quede registrada 👤",
      ["link_conversation"],
    );
    expect(v?.verdict).toBe("rejected");
    expect(v?.reason).toMatch(/save_property_to_client/);
  });

  it("la misma afirmación CON save_property_to_client ejecutada → null", () => {
    expect(
      unexecutedWriteVerdict(
        "Listo, guardé estas propiedades en el perfil de Armando 👤",
        ["link_conversation", "save_property_to_client"],
      ),
    ).toBeNull();
  });

  it("vincular la CONVERSACIÓN (no propiedades) sigue satisfecho por link_conversation → null (precisión)", () => {
    expect(
      unexecutedWriteVerdict("Listo, vinculé esta conversación al perfil de Armando 👤", ["link_conversation"]),
    ).toBeNull();
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
