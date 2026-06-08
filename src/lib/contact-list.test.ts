import { describe, it, expect } from "vitest";
import { groupLetter, groupContacts, filterContacts, type ContactListItem } from "./contact-list";

function c(partial: Partial<ContactListItem>): ContactListItem {
  return {
    id: "x", full_name: "Sin Nombre", phone: null, email: null,
    is_client: false, status: "warm", client_type: "buyer", ...partial,
  };
}

describe("groupLetter", () => {
  it("devuelve la inicial en mayúscula sin acento", () => {
    expect(groupLetter("Ángela")).toBe("A");
    expect(groupLetter("ñoño")).toBe("N");
  });
  it("agrupa nombres que no empiezan con letra bajo '#'", () => {
    expect(groupLetter("123 Empresa")).toBe("#");
    expect(groupLetter("")).toBe("#");
  });
});

describe("groupContacts", () => {
  it("agrupa por letra y ordena alfabéticamente, con '#' al final", () => {
    const groups = groupContacts([
      c({ id: "1", full_name: "Bruno" }),
      c({ id: "2", full_name: "Ana" }),
      c({ id: "3", full_name: "9 de Julio Inmob" }),
    ]);
    expect(groups.map((g) => g.letter)).toEqual(["A", "B", "#"]);
    expect(groups[0].contacts[0].full_name).toBe("Ana");
  });
});

describe("filterContacts", () => {
  const list = [
    c({ id: "1", full_name: "Ana Gómez", phone: "351111", is_client: true, status: "hot" }),
    c({ id: "2", full_name: "Bruno López", email: "bruno@mail.com", is_client: false }),
  ];
  it("filtra por texto en nombre/teléfono/email", () => {
    expect(filterContacts(list, { query: "gómez", kind: "all", status: "all" })).toHaveLength(1);
    expect(filterContacts(list, { query: "bruno@mail", kind: "all", status: "all" })).toHaveLength(1);
  });
  it("filtra por tipo cliente/contacto", () => {
    expect(filterContacts(list, { query: "", kind: "client", status: "all" })).toHaveLength(1);
    expect(filterContacts(list, { query: "", kind: "contact", status: "all" })).toHaveLength(1);
  });
  it("filtra por estado solo entre clientes", () => {
    expect(filterContacts(list, { query: "", kind: "all", status: "hot" })).toHaveLength(1);
    expect(filterContacts(list, { query: "", kind: "all", status: "cold" })).toHaveLength(0);
  });
});
