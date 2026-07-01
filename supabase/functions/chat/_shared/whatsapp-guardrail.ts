// Guardarraíl de integridad de teléfonos de WhatsApp.
//
// Incidente 86ajb5g8d: al redactar mensajes de campaña, Alan (Gemini) a veces FABRICA el teléfono
// del marcador <<<WHATSAPP_TO:número>>> (o copia uno equivocado) → el botón "Enviar por WhatsApp"
// abriría un chat con un DESCONOCIDO. Mismo patrón que los slugs/UUID inventados (link-guardrail.ts,
// card-render.ts): el modelo no transcribe confiablemente datos opacos. El daño real (mensaje a la
// persona equivocada) es 100% función del NÚMERO, así que blindamos el número.
//
// Estrategia (diseño adversarial, 3 enfoques + juez):
//  1) VALIDAR: cada teléfono del marcador se canoniza a E.164 AR de celular (+549XXXXXXXXXX) y se
//     compara EXACTO contra el set de teléfonos REALES del agente (sus clientes + los que él tipeó en
//     el turno). Ambos lados pasan por la MISMA normalización → el match exacto absorbe la
//     heterogeneidad de formatos sin el riesgo de falsos negativos de un match por sufijo.
//  2) CORREGIR: si el número no valida pero el cuerpo del borrador nombra sin ambigüedad a un cliente
//     conocido (registro por-turno de list_clients/get_client), se reemplaza por el teléfono REAL de
//     ese cliente → el botón queda correcto en vez de perderse.
//  3) NEUTRALIZAR: si no valida ni se puede corregir, se quita el marcador (el borrador queda sin
//     botón) + aviso. Nunca un botón a un número no verificado.
// Puro y testeable (sin deps de Deno/DB).

import { MSG_BREAK } from "./alan-facts.ts";

/**
 * Canoniza un teléfono a E.164 de CELULAR argentino (+549 + 10 dígitos), o null si no es un celular
 * AR plausible. null ⇒ nunca matchea ⇒ conservador por diseño. Absorbe formatos heterogéneos:
 * '+5493511234567', '5493511234567', '3511234567', '351-1234567', '03511234567', '9351 1234567',
 * '+54 351 1234567', con espacios/tabs/guiones/paréntesis.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[^\d+]/g, "");
  const d = cleaned.replace(/\+/g, ""); // solo dígitos
  if (!d) return null;

  let local10: string | null = null;
  if (d.startsWith("549") && d.length === 13) local10 = d.slice(3);          // +549 + 10
  else if (d.startsWith("54") && d.length === 12) local10 = d.slice(2);      // +54 + 10 (falta el 9)
  else if (d.startsWith("0") && d.length === 11) local10 = d.slice(1);       // 0 + area + abonado
  else if (d.startsWith("9") && d.length === 11) local10 = d.slice(1);       // 9 + 10
  else if (d.length === 10 && /^[1-9]/.test(d)) local10 = d;                 // area + abonado (formato más común en la DB)
  else return null;                                                          // parcial/ambiguo/no-AR → null

  const canon = `+549${local10}`;
  return /^\+549\d{10}$/.test(canon) ? canon : null;
}

/** Normaliza acentos + minúsculas para matchear nombres en prosa. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface ClientRef {
  name?: string | null;
  phone?: string | null; // ya normalizado (canónico) al entrar al registro
}

/**
 * Devuelve el ÚNICO cliente del registro nombrado en `body` (el cuerpo del borrador, que saluda al
 * destinatario), o null si hay 0 o ambigüedad. Matchea por nombre completo o por primer nombre como
 * palabra suelta; solo resuelve si todos los que matchean apuntan al MISMO teléfono. Puro.
 */
export function resolveUniqueClient(body: string, registry: ClientRef[]): ClientRef | null {
  if (!body || !registry?.length) return null;
  const hay = fold(body);
  const hits: ClientRef[] = [];
  for (const c of registry) {
    const name = fold(String(c.name ?? "").trim());
    if (!name) continue;
    const first = name.split(/\s+/)[0];
    if (hay.includes(name) || new RegExp(`(^|[^a-z0-9])${first}([^a-z0-9]|$)`).test(hay)) hits.push(c);
  }
  if (hits.length === 0) return null;
  const phones = new Set(hits.map((h) => h.phone).filter(Boolean));
  return phones.size === 1 ? (hits.find((h) => h.phone) ?? null) : null;
}

const WA_MARKER = /<<<WHATSAPP_TO:([^>]*)>>>/g;
const DRAFT_START = "<<<DRAFT_START>>>";
const DRAFT_END = "<<<DRAFT_END>>>";

/** Cuerpo del borrador asociado a un marcador ubicado en `offset` (entre el próximo START y su END). */
function draftBodyAfter(text: string, offset: number): string {
  const s = text.indexOf(DRAFT_START, offset);
  if (s === -1) return "";
  const e = text.indexOf(DRAFT_END, s + DRAFT_START.length);
  if (e === -1) return "";
  return text.slice(s + DRAFT_START.length, e);
}

export interface WhatsappResult {
  text: string;
  neutralized: number;
  corrected: number;
}

/**
 * Valida / corrige / neutraliza los marcadores WHATSAPP_TO de `text`.
 * - `validPhones`: set de teléfonos canónicos reales (clientes del agente + los que tipeó en el turno).
 * - `registry`: clientes surgidos en el turno (name + phone canónico) para la corrección por nombre.
 * Devuelve el texto saneado (marcadores válidos re-emitidos en forma canónica) + conteos. Puro, no lanza.
 */
export function validateAndCorrectWhatsapp(
  text: string,
  validPhones: Set<string>,
  registry: ClientRef[] = [],
): WhatsappResult {
  if (!text || !text.includes("<<<WHATSAPP_TO:")) return { text, neutralized: 0, corrected: 0 };
  let neutralized = 0;
  let corrected = 0;

  const out = text.replace(WA_MARKER, (_full: string, rawNum: string, offset: number) => {
    const canon = normalizePhone(rawNum);
    if (canon && validPhones.has(canon)) return `<<<WHATSAPP_TO:${canon}>>>`; // válido → canónico limpio
    // No valida → intentar corregir por el nombre del cuerpo del borrador.
    const client = resolveUniqueClient(draftBodyAfter(text, offset), registry);
    if (client?.phone) { corrected++; return `<<<WHATSAPP_TO:${client.phone}>>>`; }
    neutralized++;
    return ""; // no verificable → quitar el botón (nunca un número inventado)
  });

  return { text: out, neutralized, corrected };
}

/** Aviso a anexar cuando se neutralizó al menos un botón (calcado del de link-guardrail). */
export function whatsappNeutralizedNotice(n: number): string {
  if (n <= 0) return "";
  return `${MSG_BREAK}⚠️ Quité el botón de WhatsApp de ${n} ${n === 1 ? "mensaje" : "mensajes"} porque no pude verificar el número contra tus clientes. Revisá que el teléfono esté guardado en el perfil del cliente o pasámelo de nuevo.`;
}
