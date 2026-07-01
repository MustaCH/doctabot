// Renderizado DETERMINISTA de tarjetas de propiedad (server-side).
//
// Incidente 86ajangkb: Gemini no transcribe strings largos/opacos de forma confiable. Primero
// fabricaba el slug del link (y el UUID de la foto) al redactar tarjetas → páginas muertas. La v1
// del fix movió el problema a un `ref` corto por propiedad (<<<CARD:p1>>>): en un turno de
// follow-up ("pasámelos sólo en alquiler") el modelo NO reproducía los refs asignados → los tokens
// quedaban sin match → burbujas vacías.
//
// Conclusión: NO se le puede confiar al modelo NINGÚN identificador. Este módulo hace el matching
// por POSICIÓN, no por ref: el modelo solo marca DÓNDE van las tarjetas con un único <<<PROPERTIES>>>
// (o, tolerado, un <<<CARD>>> por propiedad) y el server las arma en orden desde los resultados que
// las tools juntaron ESTE turno. El modelo no escribe ningún dato opaco → nada que fabricar ni
// transcribir. Puro y testeable (sin deps de Deno/DB).

import { MSG_BREAK } from "./alan-facts.ts";

export interface PropertyCardData {
  id?: string | null;
  title?: string | null;
  office?: string | null;
  price?: number | string | null;
  currency?: string | null;
  price_exposure?: boolean | null;
  expenses_price?: number | string | null;
  expenses_currency?: string | null;
  address?: string | null;
  locality?: string | null;
  zone_neighborhood?: string | null;
  zone_city?: string | null;
  m2_total?: number | string | null;
  habitaciones?: number | null;
  banos?: number | null;
  url?: string | null;
  photo?: string | null;
}

/**
 * Agrega la atribución ?associate=<code> al final de una URL de propiedad, sin alterar el slug ni
 * romper query params existentes (usa & si ya hay ?). Sin code, devuelve la URL intacta. Puro.
 */
export function buildListingUrl(url: string, agentCode?: string | null): string {
  if (!url || !agentCode) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}associate=${agentCode}`;
}

/**
 * Arma el bloque markdown de UNA tarjeta (sin ===MSG_BREAK===: los separadores se ponen entre
 * tarjetas). Formato canónico: foto, título, oficina, precio, expensas, ubicación, superficie,
 * link. Omite líneas/partes cuando falta el dato. Puro y testeable.
 */
export function renderPropertyCard(p: PropertyCardData, agentCode?: string | null): string {
  const lines: string[] = [];
  if (p.photo) lines.push(`![foto](${p.photo})`);
  lines.push(`🏠 **${p.title ?? "Propiedad"}**`);
  if (p.office) lines.push(`🏢 ${p.office}`);

  if (p.price_exposure === false || p.price == null || p.price === "") {
    lines.push(`💰 Precio: a consultar`);
  } else {
    lines.push(`💰 Precio: ${p.currency ? `${p.currency} ` : ""}${p.price}`);
  }
  if (p.expenses_price != null && p.expenses_price !== "" && Number(p.expenses_price) > 0) {
    lines.push(`Expensas: $${p.expenses_price} ${p.expenses_currency ?? "ARS"}/mes`);
  }

  const loc: string[] = [];
  if (p.address) loc.push(String(p.address));
  if (p.locality) loc.push(String(p.locality));
  let locLine = loc.join(", ");
  const paren = p.zone_neighborhood || p.zone_city;
  if (paren) locLine += `${locLine ? " " : ""}(${paren})`;
  if (locLine) lines.push(`📍 Ubicación: ${locLine}`);

  if (p.m2_total != null && p.m2_total !== "") {
    const extras: string[] = [];
    if (p.habitaciones != null) extras.push(`${p.habitaciones} hab`);
    if (p.banos != null) extras.push(`${p.banos} baños`);
    lines.push(`📐 Superficie: ${p.m2_total} m² totales${extras.length ? ` (${extras.join(" · ")})` : ""}`);
  }

  if (p.url) lines.push(`🔗 [Ver propiedad](${buildListingUrl(p.url, agentCode)})`);

  return lines.join("\n");
}

/** Une varias tarjetas con el separador de burbujas. */
function joinCards(cards: PropertyCardData[], agentCode?: string | null): string {
  return cards.map((c) => renderPropertyCard(c, agentCode)).join(MSG_BREAK);
}

// Marcadores que el modelo puede emitir para ubicar las tarjetas:
//  - <<<PROPERTIES>>>  → volcá TODOS los resultados restantes acá (forma recomendada).
//  - <<<CARD>>> / <<<CARD:loquesea>>> → una tarjeta (el siguiente resultado). El ref, si viene, se
//    IGNORA: el match es por posición. Tolerado por compatibilidad y por si el modelo lo usa igual.
const MARKER = /<<<PROPERTIES>>>|<<<CARD(?::[a-z0-9_-]+)?\s*>>>/gi;

/**
 * Reemplaza los marcadores por tarjetas tomadas EN ORDEN de `results` (una cola que se consume de
 * izquierda a derecha). El matching es por posición, no por ref → inmune a que el modelo invente,
 * renumere o no reproduzca identificadores. Devuelve el texto, cuántas se renderizaron, cuántas
 * quedaron sin ubicar (`leftover`) y si hubo algún marcador. Puro, no lanza.
 */
export function expandCards(
  text: string,
  results: PropertyCardData[],
  agentCode?: string | null,
): { text: string; rendered: number; leftover: PropertyCardData[]; hadMarker: boolean } {
  const queue = [...(results ?? [])];
  if (!text) return { text, rendered: 0, leftover: queue, hadMarker: false };
  let rendered = 0;
  let hadMarker = false;
  const out = text.replace(MARKER, (m: string) => {
    hadMarker = true;
    if (/^<<<PROPERTIES>>>$/i.test(m)) {
      const all = queue.splice(0, queue.length);
      rendered += all.length;
      return all.length ? joinCards(all, agentCode) : "";
    }
    const p = queue.shift();
    if (!p) return "";
    rendered++;
    return renderPropertyCard(p, agentCode);
  });
  return { text: out, rendered, leftover: queue, hadMarker };
}

/**
 * Colapsa segmentos vacíos entre ===MSG_BREAK=== (evita burbujas fantasma si un marcador se
 * expandió a vacío o si el modelo dejó separadores de más). Conserva el orden del resto. Puro.
 */
export function collapseEmptyBubbles(text: string): string {
  if (!text || !text.includes(MSG_BREAK)) return text;
  const parts = text.split(MSG_BREAK).map((s) => s.trim()).filter((s) => s.length > 0);
  return parts.join(`\n${MSG_BREAK}\n`);
}
