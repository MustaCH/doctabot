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
    c({ id: "1", full_name: "Ana Gómez", phone: "351111", is_client: true, status: "hot", client_type: "buyer" }),
    c({ id: "2", full_name: "Bruno López", email: "bruno@mail.com", is_client: false }),
    c({ id: "3", full_name: "Carla Vende", is_client: true, status: "warm", client_type: "seller" }),
    c({ id: "4", full_name: "Diego Ambos", is_client: true, status: "warm", client_type: "both" }),
  ];
  const ids = (items: ContactListItem[]) => items.map((x) => x.id).sort();

  it("Compradores: clientes con client_type buyer o both", () => {
    expect(ids(filterContacts(list, { query: "", kind: "buyer", status: "all" }))).toEqual(["1", "4"]);
  });
  it("Vendedores: clientes con client_type seller o both", () => {
    expect(ids(filterContacts(list, { query: "", kind: "seller", status: "all" }))).toEqual(["3", "4"]);
  });
  it("Contactos: solo is_client = false", () => {
    expect(ids(filterContacts(list, { query: "", kind: "contact", status: "all" }))).toEqual(["2"]);
  });
  it("un contacto both aparece tanto en Compradores como en Vendedores", () => {
    expect(filterContacts(list, { query: "", kind: "buyer", status: "all" }).some((x) => x.id === "4")).toBe(true);
    expect(filterContacts(list, { query: "", kind: "seller", status: "all" }).some((x) => x.id === "4")).toBe(true);
  });
  it("un contacto (is_client = false) no aparece en Compradores ni Vendedores", () => {
    expect(filterContacts(list, { query: "", kind: "buyer", status: "all" }).some((x) => x.id === "2")).toBe(false);
    expect(filterContacts(list, { query: "", kind: "seller", status: "all" }).some((x) => x.id === "2")).toBe(false);
  });
  it("filtra por texto en nombre/teléfono/email", () => {
    expect(filterContacts(list, { query: "gómez", kind: "buyer", status: "all" })).toHaveLength(1);
    expect(filterContacts(list, { query: "bruno@mail", kind: "contact", status: "all" })).toHaveLength(1);
  });
  it("filtra por estado dentro del tipo seleccionado", () => {
    expect(filterContacts(list, { query: "", kind: "buyer", status: "hot" })).toHaveLength(1);
    expect(filterContacts(list, { query: "", kind: "buyer", status: "cold" })).toHaveLength(0);
  });
});
