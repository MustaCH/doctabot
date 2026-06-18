export interface ContactListItem {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_client: boolean;
  status: string;
  client_type: string;
}

export type ContactKind = "buyer" | "seller" | "contact";
export type StatusFilter = "all" | "hot" | "warm" | "cold";

export interface ContactFilters {
  query: string;
  kind: ContactKind;
  status: StatusFilter;
}

export interface ContactGroup {
  letter: string;
  contacts: ContactListItem[];
}

/** Quita acentos para normalizar comparaciones/agrupación. */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Letra de agrupación: inicial sin acento en mayúscula, o '#' si no es A-Z. */
export function groupLetter(fullName: string): string {
  const first = stripAccents(fullName.trim()).charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

/** Agrupa contactos por letra inicial, ordenados A-Z con '#' al final. */
export function groupContacts(contacts: ContactListItem[]): ContactGroup[] {
  const map = new Map<string, ContactListItem[]>();
  for (const c of contacts) {
    const letter = groupLetter(c.full_name);
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter)!.push(c);
  }
  const letters = [...map.keys()].sort((a, b) => {
    if (a === "#") return 1;
    if (b === "#") return -1;
    return a.localeCompare(b, "es");
  });
  return letters.map((letter) => ({
    letter,
    contacts: map.get(letter)!.sort((a, b) => a.full_name.localeCompare(b.full_name, "es")),
  }));
}

/** Filtra por texto (nombre/teléfono/email), tipo y estado. */
export function filterContacts(contacts: ContactListItem[], f: ContactFilters): ContactListItem[] {
  let result = contacts;
  // Compradores/Vendedores: clientes según client_type (both cuenta en ambos). Contactos: no clientes.
  if (f.kind === "buyer") result = result.filter((c) => c.is_client && (c.client_type === "buyer" || c.client_type === "both"));
  else if (f.kind === "seller") result = result.filter((c) => c.is_client && (c.client_type === "seller" || c.client_type === "both"));
  else if (f.kind === "contact") result = result.filter((c) => !c.is_client);

  if (f.status !== "all") result = result.filter((c) => c.is_client && c.status === f.status);

  const q = stripAccents(f.query.trim().toLowerCase());
  if (q) {
    result = result.filter((c) =>
      stripAccents(c.full_name.toLowerCase()).includes(q) ||
      (c.phone?.toLowerCase().includes(q) ?? false) ||
      (c.email?.toLowerCase().includes(q) ?? false)
    );
  }
  return result;
}
