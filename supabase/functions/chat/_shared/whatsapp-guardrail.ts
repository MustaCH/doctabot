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
import { nameDedupKey } from "./tools/validators.ts";

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

/** Escape para meter un nombre folded dentro de una RegExp. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Devuelve el ÚNICO cliente del registro nombrado en `body` (el cuerpo del borrador, que saluda al
 * destinatario), o null si hay 0 o ambigüedad. Exige el nombre COMPLETO del cliente presente en el
 * cuerpo (el match por primer nombre suelto quedó prohibido: recombinaba un nombre inventado con el
 * teléfono REAL de otra persona — incidente de campañas fabricadas). Solo resuelve si todos los que
 * matchean apuntan al MISMO teléfono. Puro.
 */
export function resolveUniqueClient(body: string, registry: ClientRef[]): ClientRef | null {
  if (!body || !registry?.length) return null;
  const hay = fold(body).replace(/\s+/g, " ");
  const hits: ClientRef[] = [];
  for (const c of registry) {
    const name = fold(String(c.name ?? "").trim()).replace(/\s+/g, " ");
    if (!name) continue;
    // Nombre completo como secuencia delimitada por no-alfanuméricos (evita que "Ana" matchee "Susana").
    if (new RegExp(`(^|[^a-z0-9])${escapeRe(name)}([^a-z0-9]|$)`).test(hay)) hits.push(c);
  }
  if (hits.length === 0) return null;
  const phones = new Set(hits.map((h) => h.phone).filter(Boolean));
  return phones.size === 1 ? (hits.find((h) => h.phone) ?? null) : null;
}

const DRAFT_START = "<<<DRAFT_START>>>";
const DRAFT_END = "<<<DRAFT_END>>>";

// Un BLOQUE de WhatsApp = marcador + (opcionalmente) su borrador. El grupo del draft matchea si el
// DRAFT_START sigue al marcador con hasta 200 caracteres intermedios sin '<' (whitespace o texto
// corto tipo "Para María:\n"): antes se exigía \s* y bastaba una línea intercalada para que el
// bloque esquivara la validación y el borrador inventado quedara visible (M4). El tope de 200 y la
// exclusión de '<' evitan que un marcador suelto se trague texto ajeno u otro marcador.
const WA_BLOCK = /<<<WHATSAPP_TO:([^>]*)>>>(?:([^<]{0,200})(<<<DRAFT_START>>>[\s\S]*?<<<DRAFT_END>>>))?/g;

// Stop-list de palabras de prosa/saludo (folded, sin acentos): si el "nombre" capturado contiene
// alguna, NO es un nombre saludado ("Hola, espero que estés bien" no saluda a nadie). Ver B2.
const GREETING_STOP_WORDS = new Set([
  "hola", "espero", "como", "que", "buenos", "buenas", "buen", "dia", "dias", "tardes", "noches",
  "estimado", "estimada", "estimados", "estimadas", "querido", "querida", "queridos", "queridas",
  "equipo", "cliente", "clientes", "sr", "sra", "srta", "senor", "senora", "senorita", "don",
  "dona", "todos", "todas", "bien", "estas", "esta",
]);

/**
 * Extrae el nombre SALUDADO al inicio del cuerpo de un borrador ("Hola María González, …"),
 * folded (minúsculas, sin acentos), o null si no hay saludo reconocible. Un capturado solo cuenta
 * como nombre si tiene ≤3 palabras y ninguna está en la stop-list de prosa: antes "Hola, espero que
 * estés bien" devolvía "espero que estes bien" y el guardarraíl eliminaba borradores LEGÍTIMOS con
 * un aviso mentiroso (B2). Puro.
 */
export function extractGreetedName(body: string): string | null {
  const hay = fold(body).replace(/[ \t]+/g, " ");
  const m = hay.match(
    /(?:^|\n) ?(?:¡\s*)?(?:hola|buenas(?: tardes| noches)?|buen dia|buenos dias|estimad[oa]s?|querid[oa]s?)[\s,!]+([a-z][a-z ]{1,60}?)(?=[,.!:;\n]|$)/,
  );
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  const words = name.split(" ").filter(Boolean);
  if (words.length > 3) return null; // un nombre real no tiene 4+ palabras: es prosa
  if (words.some((w) => GREETING_STOP_WORDS.has(w))) return null;
  return name;
}

/** ¿La clave folded del saludo comparte identidad con `name`? (nombre completo, o al menos una
 *  palabra significativa — tolera saludar solo por el primer nombre). */
function nameKeyMatches(greetedKey: string, name: string): boolean {
  const ok = nameDedupKey(name);
  if (!ok) return false;
  if (greetedKey === ok || greetedKey.startsWith(`${ok} `)) return true;
  const gWords = new Set(greetedKey.split(" ").filter((w) => w.length >= 2));
  for (const w of ok.split(" ")) {
    if (w.length >= 2 && gWords.has(w)) return true;
  }
  return false;
}

/** ¿El nombre saludado corresponde a alguno de los dueños del teléfono? */
function greetedMatchesOwner(greeted: string, ownerNames: string[]): boolean {
  const gk = nameDedupKey(greeted);
  if (!gk) return true; // sin señal utilizable → no bloquear por falta de evidencia
  return ownerNames.some((o) => nameKeyMatches(gk, o));
}

/**
 * Evidencia de RECOMBINACIÓN (B2): ¿el nombre saludado corresponde a OTRO cliente conocido
 * (registro del turno o agenda) cuyo teléfono NO es `phone`? Solo con esta evidencia se elimina un
 * bloque con teléfono válido — un saludo que no matchea a NINGÚN cliente (prosa, apodo,
 * "Sra. García") no alcanza para invalidar un teléfono que ya validó contra la agenda.
 */
function greetedMatchesOtherClient(
  greeted: string,
  phone: string,
  registry: ClientRef[],
  owners: Map<string, string[]>,
): boolean {
  const gk = nameDedupKey(greeted);
  if (!gk) return false;
  for (const c of registry) {
    if (!c.name || (c.phone && c.phone === phone)) continue;
    if (nameKeyMatches(gk, String(c.name))) return true;
  }
  for (const [p, names] of owners) {
    if (p === phone) continue;
    for (const n of names) {
      if (nameKeyMatches(gk, n)) return true;
    }
  }
  return false;
}

export interface WhatsappBlockOptions {
  /** Teléfonos canónicos REALES (agenda completa del agente + los tipeados en el turno). */
  validPhones: Set<string>;
  /** Dueño(s) de cada teléfono canónico de la agenda (para la validación de identidad del saludo). */
  phoneOwners?: Map<string, string[]>;
  /** Contactos surgidos en el turno (list_clients/get_client + cliente sembrado) para corrección por nombre. */
  registry?: ClientRef[];
  /** true si list_clients/get_client corrió en ESTE turno (gate estructural anti campaña-de-memoria). */
  toolVerified: boolean;
  /** Teléfonos del cliente activo sembrado en la conversación: pasan aunque no haya corrido la tool. */
  seedPhones?: Set<string>;
}

export interface WhatsappBlockResult {
  text: string;
  /** Bloques marcador+borrador encontrados. */
  blocksTotal: number;
  /** Bloques que sobrevivieron (verificados o corregidos). */
  blocksKept: number;
  /** Bloques ENTEROS eliminados (marcador + borrador): destinatario inventado o identidad que no corresponde. */
  removedBlocks: number;
  /** Marcadores corregidos al teléfono real (nombre completo sin ambigüedad en el cuerpo). */
  corrected: number;
  /** Marcadores SUELTOS (sin borrador) no verificables, quitados (el texto que sigue queda). */
  neutralizedMarkers: number;
}

/**
 * Validación de BLOQUES de WhatsApp (incidente de contactos inventados en campañas): por cada par
 * <<<WHATSAPP_TO>>> + borrador:
 *  1. Gate estructural: si list_clients/get_client NO corrió en el turno, solo pasan los bloques del
 *     cliente activo sembrado; el resto se considera fabricado de memoria y se elimina ENTERO.
 *  2. Teléfono fuera de la agenda → se intenta corregir por nombre COMPLETO (registro del turno);
 *     si no se puede, se elimina el bloque ENTERO (antes se borraba solo el marcador y quedaba
 *     visible un borrador con nombre inventado).
 *  3. Teléfono real pero el nombre saludado NO corresponde al dueño de ese teléfono → se elimina el
 *     bloque ENTERO (recombinación nombre inventado + teléfono real de otra persona).
 * Los marcadores válidos se re-emiten canónicos. Puro, no lanza.
 */
export function sanitizeWhatsappBlocks(text: string, opts: WhatsappBlockOptions): WhatsappBlockResult {
  const res: WhatsappBlockResult = { text, blocksTotal: 0, blocksKept: 0, removedBlocks: 0, corrected: 0, neutralizedMarkers: 0 };
  if (!text || !text.includes("<<<WHATSAPP_TO:")) return res;
  const owners = opts.phoneOwners ?? new Map<string, string[]>();
  const registry = opts.registry ?? [];
  const seed = opts.seedPhones ?? new Set<string>();

  res.text = text.replace(WA_BLOCK, (_full: string, rawNum: string, between: string | undefined, draft: string | undefined) => {
    const hasDraft = typeof draft === "string" && draft.length > 0;
    if (hasDraft) res.blocksTotal++;
    const body = hasDraft ? draft!.slice(DRAFT_START.length, draft!.length - DRAFT_END.length) : "";
    const canon = normalizePhone(rawNum);
    const phoneKnown = !!canon && opts.validPhones.has(canon);
    // Texto intercalado entre marcador y borrador ("Para María:\n"): se conserva al re-emitir el
    // bloque; si era solo whitespace se normaliza a un salto de línea (M4).
    const glue = hasDraft ? (between && between.trim() ? between : "\n") : "";

    const keep = (phone: string) => {
      if (hasDraft) res.blocksKept++;
      return `<<<WHATSAPP_TO:${phone}>>>${glue}${hasDraft ? draft : ""}`;
    };
    const remove = () => {
      if (hasDraft) res.removedBlocks++;
      else res.neutralizedMarkers++;
      return "";
    };

    // 1) Gate estructural: sin tool de contactos en el turno, solo pasan el cliente sembrado y los
    //    teléfonos tipeados por el agente en el turno (llegan por seedPhones — ver index.ts, B3).
    if (!opts.toolVerified && !(canon && seed.has(canon))) return remove();

    // 2) Teléfono fuera de la agenda → corregir por nombre completo o eliminar el bloque entero.
    if (!phoneKnown) {
      const client = hasDraft ? resolveUniqueClient(body, registry) : null;
      if (client?.phone && (opts.toolVerified || seed.has(client.phone))) {
        res.corrected++;
        if (hasDraft) res.blocksKept++;
        return `<<<WHATSAPP_TO:${client.phone}>>>${glue}${hasDraft ? draft : ""}`;
      }
      return remove();
    }

    // 3) Teléfono real: solo eliminamos ante evidencia de RECOMBINACIÓN (B2) — el saludo nombra a
    //    OTRO cliente conocido, distinto del dueño de ESTE teléfono (nombre de cliente B con el
    //    teléfono de cliente A). Un saludo que no matchea a ningún cliente (prosa, apodo,
    //    "Sra. García", sin nombre) PASA: el teléfono ya validó contra la agenda y eliminar un
    //    borrador legítimo con un aviso mentiroso es peor que tolerar un saludo informal.
    //    Con teléfono sin dueño conocido (tipeado por el agente) no hay identidad que validar.
    if (hasDraft) {
      const ownerNames = [
        ...(owners.get(canon!) ?? []),
        ...registry.filter((c) => c.phone === canon).map((c) => String(c.name ?? "")),
      ].filter(Boolean);
      if (ownerNames.length > 0) {
        const greeted = extractGreetedName(body);
        if (greeted && !greetedMatchesOwner(greeted, ownerNames) &&
            greetedMatchesOtherClient(greeted, canon!, registry, owners)) {
          return remove();
        }
      }
    }
    return keep(canon!);
  });

  return res;
}

/** Aviso a anexar cuando se quitó el botón de un marcador SUELTO (calcado del de link-guardrail). */
export function whatsappNeutralizedNotice(n: number): string {
  if (n <= 0) return "";
  return `${MSG_BREAK}⚠️ Quité el botón de WhatsApp de ${n} ${n === 1 ? "mensaje" : "mensajes"} porque no pude verificar el número contra tus clientes. Revisá que el teléfono esté guardado en el perfil del cliente o pasámelo de nuevo.`;
}

/** Aviso HONESTO cuando se eliminaron bloques enteros (destinatarios que no salen de la agenda). */
export function whatsappRemovedNotice(n: number): string {
  if (n <= 0) return "";
  return `${MSG_BREAK}⚠️ Eliminé ${n} ${n === 1 ? "borrador dirigido a un contacto que NO figura" : "borradores dirigidos a contactos que NO figuran"} en tu agenda — probablemente los inventé por error. Pedime la tanda de nuevo y trabajo solo con list_clients.`;
}

/** Aviso visible cuando se corrigió el número de un borrador por el teléfono real del cliente nombrado. */
export function whatsappCorrectedNotice(n: number): string {
  if (n <= 0) return "";
  return `${MSG_BREAK}⚠️ Corregí el teléfono de ${n} ${n === 1 ? "borrador" : "borradores"}: el número que había escrito no coincidía con el guardado en tu agenda para ese cliente. Verificá el destinatario antes de enviar.`;
}

// Token con pinta de teléfono. El filtro real es normalizePhone: solo cuentan los que canonizan
// a celular AR — precios (68000, 1.350.000), conteos y m² no llegan a 10 dígitos y quedan afuera.
// OJO: sin \n en la clase — con \s el greedy fusionaba números de renglones consecutivos
// ("...2630\n2. Ruth") y el token fusionado no canonizaba → el guardarraíl no veía nada.
const PHONE_TOKEN = /\+?\d[\d \t().\-]{8,16}\d/g;

export interface ContactListVerifyResult {
  text: string;
  totalPhones: number;
  flagged: number;
}

/**
 * Verificación de LISTAS de contactos (86ajbr466): cuando la respuesta lista teléfonos (una campaña,
 * "pasame 100 contactos"), cada número se canoniza y se busca en `validKeys` (los teléfonos REALES
 * del CRM del agente + los tipeados en el turno). Si 3 o más NO figuran, el modelo probablemente
 * FABRICÓ la lista: se marca cada número no verificado con ⚠️ y se anexa un aviso. Con <3 no
 * verificados no se toca nada (evita falsos positivos con fijos/junk). Los teléfonos DENTRO de los
 * marcadores <<<WHATSAPP_TO:…>>> SÍ cuentan para el umbral (una tanda de 10 borradores falsos debe
 * disparar el aviso), pero NO se anotan con ⚠️ inline (anotar adentro rompería el front; el bloque
 * en sí lo valida sanitizeWhatsappBlocks).
 *
 * `thresholdText` (m6): el UMBRAL se calcula sobre el texto PRE-saneo (antes de que
 * sanitizeWhatsappBlocks elimine bloques) — post-saneo los marcadores eliminados ya no existen y el
 * umbral nunca los veía. La ANOTACIÓN y los números del aviso siguen sobre el texto post-saneo
 * (lo que el usuario realmente ve). Sin thresholdText, umbral y anotación usan el mismo texto.
 * Puro y testeable, no lanza.
 */
export function verifyContactListPhones(text: string, validKeys: Set<string>, thresholdText?: string): ContactListVerifyResult {
  if (!text) return { text, totalPhones: 0, flagged: 0 };
  // Partimos por los marcadores para no ANOTAR su interior (pero sí contarlo).
  const countPhones = (src: string): { total: number; bad: number } => {
    let total = 0;
    let bad = 0;
    for (const part of src.split(/(<<<WHATSAPP_TO:[^>]*>>>)/)) {
      for (const m of part.match(PHONE_TOKEN) ?? []) {
        const canon = normalizePhone(m);
        if (!canon) continue;
        total++;
        if (!validKeys.has(canon)) bad++;
      }
    }
    return { total, bad };
  };
  // Pasada 1 (umbral): sobre el texto PRE-saneo si vino, para que los bloques fabricados que el
  // saneo eliminó sigan disparando la alerta sobre los números que quedaron visibles.
  const thr = countPhones(thresholdText ?? text);
  if (thr.bad < 3) return { text, totalPhones: thr.total, flagged: 0 };
  // Números del aviso: sobre el texto POST-saneo (lo visible). Si el saneo ya eliminó a todos los
  // infractores, no hay nada que anotar (el aviso de bloques eliminados ya lo cubre).
  const post = countPhones(text);
  if (post.bad === 0) return { text, totalPhones: post.total, flagged: 0 };
  // Pasada 2: anotar los no verificados.
  const parts = text.split(/(<<<WHATSAPP_TO:[^>]*>>>)/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith("<<<WHATSAPP_TO:")) continue;
    parts[i] = parts[i].replace(PHONE_TOKEN, (m: string) => {
      const canon = normalizePhone(m);
      if (!canon || validKeys.has(canon)) return m;
      return `${m} ⚠️`;
    });
  }
  const notice = `${MSG_BREAK}⚠️ ATENCIÓN: ${post.bad} de los ${post.total} teléfonos de esta lista NO figuran en tu agenda — es probable que sean incorrectos. No los uses sin verificar: pedime la lista de nuevo y la saco directo de tus contactos reales.`;
  return { text: parts.join("") + notice, totalPhones: post.total, flagged: post.bad };
}
