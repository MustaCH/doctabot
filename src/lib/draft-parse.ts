// Parseo puro de los marcadores de borrador que emite Alan (<<<DRAFT_START>>>, <<<DRAFT_END>>>,
// <<<WHATSAPP_TO:+549...>>>) → segmentos de texto + drafts copiables. Extraído de ChatMessage.tsx
// para testearlo sin React (tickets: marcadores crudos renderizados / parser robusto).
//
// Contrato con el backend: los strings EXACTOS viven también en supabase/functions/chat/_shared
// (prompt / stream-turn) y en stream-markers.ts. No cambiarlos.
//
// INVARIANTE (testeada en draft-parse.test.ts): ningún segmento de texto que sale de acá contiene
// un marcador <<<...>>> — todo texto pasa por stripDraftMarkers antes de llegar a ReactMarkdown.

import { MSG_BREAK } from "./stream-markers";

export const DRAFT_START = "<<<DRAFT_START>>>";
export const DRAFT_END = "<<<DRAFT_END>>>";
export const WHATSAPP_TO_PREFIX = "<<<WHATSAPP_TO:";

export type DraftSegment =
  | { type: "text"; text: string }
  | { type: "draft"; draft: string; whatsappNumber?: string };

/**
 * ¿La burbuja contiene ALGÚN marcador de draft? Gate de precedencia en ChatMessage: si hay
 * marcadores, los parsers de tarjetas (property/contact) NO corren — si no, una campaña con 🏠
 * dentro de un borrador activaba parseMultiplePropertyCards y los marcadores se veían crudos.
 */
export function hasDraftMarkers(content: string): boolean {
  return content.includes(DRAFT_START) || content.includes(DRAFT_END) || content.includes(WHATSAPP_TO_PREFIX);
}

// Barrido final: cualquier marcador que haya quedado suelto en un segmento de texto se elimina.
const MARKER_SWEEP_RE = /<<<(?:DRAFT_START|DRAFT_END|WHATSAPP_TO:[^>]*)>>>/g;

export function stripDraftMarkers(text: string): string {
  return text.replace(MARKER_SWEEP_RE, "");
}

// Red final genérica: cualquier marcador de protocolo <<<ALGO>>> o <<<ALGO:args>>> — aunque sea
// uno que este parser no conoce o venga malformado desde la DB — se barre antes de llegar a
// ReactMarkdown. Anclado a NOMBRE EN MAYÚSCULAS para no tocar texto legítimo con "<<<".
const GENERIC_MARKER_RE = /<<<[A-Z_]+(?::[^>]*)?>>>/g;

/**
 * Barrido completo: marcadores de draft conocidos + cualquier <<<MARCADOR>>> genérico.
 * Lo usan el fallback de render (nada crudo llega a ReactMarkdown) y las acciones
 * Copiar/Citar (el portapapeles y el bloque [REFERENCIA] no deben llevar marcadores).
 */
export function stripAllMarkers(text: string): string {
  return stripDraftMarkers(text).replace(GENERIC_MARKER_RE, "");
}

/**
 * Valida/normaliza el número del botón "Enviar por WhatsApp". Mensajes viejos en DB pueden traer
 * un WHATSAPP_TO con cualquier cosa ("hola mundo") — solo devolvemos el número (sin espacios,
 * paréntesis ni guiones) si parece un teléfono real; si no, undefined (header genérico, sin botón).
 */
export function normalizeWhatsappNumber(raw?: string): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.replace(/[\s()-]/g, "");
  return /^\+?\d{8,15}$/.test(normalized) ? normalized : undefined;
}

// Tokenizer tolerante: un WHATSAPP_TO opcional inmediatamente antes (solo whitespace en el medio)
// + DRAFT_START + contenido hasta DRAFT_END o el fin del mensaje (draft sin cerrar = draft igual).
const DRAFT_BLOCK_RE = /(?:<<<WHATSAPP_TO:\s*([^>]*?)\s*>>>\s*)?<<<DRAFT_START>>>([\s\S]*?)(?:<<<DRAFT_END>>>|$)/g;

/**
 * Extrae TODOS los drafts del contenido, intercalando segmentos de texto ya barridos de marcadores.
 * Reglas:
 *  - Draft sin cerrar → draft igual (nunca texto crudo).
 *  - WHATSAPP_TO sin draft a continuación (o un segundo WHATSAPP_TO en el mismo prefijo) → se barre,
 *    no queda visible.
 *  - Sin mínimo de longitud: un draft de 5 chars es un draft. Solo se descarta el draft VACÍO.
 * Devuelve null si el contenido no tiene marcadores o no quedó nada que mostrar.
 */
export function parseDraftSegments(content: string): DraftSegment[] | null {
  if (!hasDraftMarkers(content)) return null;

  const segments: DraftSegment[] = [];
  const pushText = (raw: string) => {
    const text = stripDraftMarkers(raw).trim();
    if (text) segments.push({ type: "text", text });
  };

  DRAFT_BLOCK_RE.lastIndex = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DRAFT_BLOCK_RE.exec(content)) !== null) {
    pushText(content.slice(lastIndex, m.index));
    const whatsappNumber = m[1]?.trim() || undefined;
    // El contenido del draft también se barre: un marcador anidado (modelo desbalanceado) no
    // debe verse crudo ni copiarse al portapapeles.
    const draft = stripDraftMarkers(m[2]).trim();
    if (draft) segments.push({ type: "draft", draft, whatsappNumber });
    lastIndex = m.index + m[0].length;
    if (m[0].length === 0) DRAFT_BLOCK_RE.lastIndex++; // guarda anti-loop (DRAFT_START nunca es vacío)
  }
  pushText(content.slice(lastIndex));

  return segments.length > 0 ? segments : null;
}

/**
 * Split de burbujas consciente de drafts: corta por ===MSG_BREAK=== SALVO dentro de una región
 * <<<DRAFT_START>>>…<<<DRAFT_END>>> (o de un draft sin cerrar, que se extiende hasta el final).
 * Es el equivalente post-hoc de MarkerStream (streaming): ambos caminos deben partir el MISMO
 * texto en las MISMAS burbujas (test de paridad en draft-parse.test.ts). Lo usa
 * use-chat-messages.ts al recargar mensajes de la DB.
 */
export function splitBubbles(text: string): string[] {
  const bubbles: string[] = [];
  let current = "";
  let rest = text;
  while (rest.length > 0) {
    const mb = rest.indexOf(MSG_BREAK);
    const ds = rest.indexOf(DRAFT_START);
    // MSG_BREAK antes de cualquier draft → corta burbuja.
    if (mb !== -1 && (ds === -1 || mb < ds)) {
      bubbles.push(current + rest.slice(0, mb));
      current = "";
      rest = rest.slice(mb + MSG_BREAK.length);
      continue;
    }
    // Región de draft: se copia entera (un MSG_BREAK adentro NO corta), abierta hasta el final si no cierra.
    if (ds !== -1) {
      const de = rest.indexOf(DRAFT_END, ds + DRAFT_START.length);
      const end = de === -1 ? rest.length : de + DRAFT_END.length;
      current += rest.slice(0, end);
      rest = rest.slice(end);
      continue;
    }
    current += rest;
    rest = "";
  }
  bubbles.push(current);
  return bubbles.map((b) => b.trim()).filter(Boolean);
}
