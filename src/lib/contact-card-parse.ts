// Lógica pura de parsing de mensajes de Alan → tarjetas de contacto (handoff contact-cards).
// Espejo de src/lib/property-card-parse.ts: sin deps de React/lucide/hooks, con fallback a texto
// si un bloque no parsea.
//
// OJO: el formato lo emite el backend en supabase/functions/chat/_shared/card-render.ts
// (renderContactCard) — es un CONTRATO, ver src/lib/contact-card-contract.test.ts. El bloque
// nunca contiene 🏠 (el detector de tarjetas de propiedad cuenta 🏠 y corre antes en la cadena).

export type ContactStatus = "hot" | "warm" | "cold";

export interface ContactCardProps {
  name: string;
  /** Chip de tipo: "Comprador" / "Vendedor" / "Comprador/Vendedor" / "Contacto". */
  typeLabel?: string;
  status?: ContactStatus;
  phone?: string;
  email?: string;
  /** Texto después de "🔍 Busca: " (tipo · zona · presupuesto). */
  seeking?: string;
  /** Valor crudo del server: "hoy" / "ayer" / "hace N días" / "nunca". */
  lastContactLabel: string;
  /** Días desde el último contacto; null = "nunca". */
  lastContactDays: number | null;
  /** Ruta interna "/clients/<id>" si el server emite la línea [Ver perfil](…). Opcional. */
  profilePath?: string;
}

// El server emite 🟡 Tibio; el resto del front usa ☀️ Tibio — se aceptan los dos.
const STATUS_BY_LABEL: Record<string, ContactStatus> = {
  "🔥 Caliente": "hot",
  "🟡 Tibio": "warm",
  "☀️ Tibio": "warm",
  "❄️ Frío": "cold",
};

const TYPE_LABELS = new Set(["Comprador", "Vendedor", "Comprador/Vendedor", "Contacto"]);

const PROFILE_LINK_RE = /^\[Ver perfil\]\((\/clients\/[^)\s]+)\)$/;

/** "hoy" → 0, "ayer" → 1, "hace N días" → N, "nunca" → null. Cualquier otra cosa → null. */
export function parseLastContactDays(label: string): number | null {
  if (label === "hoy") return 0;
  if (label === "ayer") return 1;
  const m = label.match(/^hace (\d+) días?$/);
  if (m) return Number(m[1]);
  return null;
}

/** Semáforo del indicador de último contacto: verde <7 días / amarillo <30 / rojo ≥30 o nunca. */
export function lastContactTone(days: number | null): "green" | "amber" | "red" {
  if (days === null) return "red";
  if (days < 7) return "green";
  if (days < 30) return "amber";
  return "red";
}

/** Try to parse a markdown block into structured contact data */
export function parseContactCard(md: string): ContactCardProps | null {
  // Los bloques de contacto nunca traen 🏠; si aparece, esto es territorio de PropertyCard.
  if (md.includes("🏠")) return null;

  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // La primera línea garantizada por contrato: 👤 **Nombre**
  const nameMatch = lines[0].match(/^👤\s*\*\*(.+?)\*\*$/);
  if (!nameMatch) return null;
  const name = nameMatch[1];

  let typeLabel: string | undefined;
  let status: ContactStatus | undefined;
  let phone: string | undefined;
  let email: string | undefined;
  let seeking: string | undefined;
  let lastContactLabel: string | undefined;
  let profilePath: string | undefined;

  for (const line of lines.slice(1)) {
    if (line.startsWith("🏷️")) {
      const chips = line.replace(/^🏷️\s*/, "").split(" · ");
      for (const chip of chips) {
        if (TYPE_LABELS.has(chip)) typeLabel = chip;
        else if (STATUS_BY_LABEL[chip]) status = STATUS_BY_LABEL[chip];
      }
      continue;
    }
    if (line.startsWith("📱")) {
      phone = line.replace(/^📱\s*/, "");
      continue;
    }
    if (line.startsWith("✉️")) {
      email = line.replace(/^✉️\s*/, "");
      continue;
    }
    if (line.startsWith("🔍")) {
      seeking = line.replace(/^🔍\s*/, "").replace(/^Busca:\s*/i, "");
      continue;
    }
    if (line.startsWith("🕓")) {
      lastContactLabel = line.replace(/^🕓\s*/, "").replace(/^Último contacto:\s*/i, "");
      continue;
    }
    const profileMatch = line.match(PROFILE_LINK_RE);
    if (profileMatch) {
      profilePath = profileMatch[1];
      continue;
    }
  }

  // La otra línea garantizada por contrato: 🕓 Último contacto. Sin ella, fallback a texto.
  if (!lastContactLabel) return null;

  return {
    name,
    typeLabel,
    status,
    phone,
    email,
    seeking,
    lastContactLabel,
    lastContactDays: parseLastContactDays(lastContactLabel),
    profilePath,
  };
}

export interface ContactSegment {
  type: "text" | "contact";
  text?: string;
  contact?: ContactCardProps;
}

/** ¿Esta línea pertenece a un bloque de contacto ya abierto? */
function isContactBlockLine(trimmed: string): boolean {
  return (
    trimmed === "" ||
    trimmed.startsWith("🏷️") ||
    trimmed.startsWith("📱") ||
    trimmed.startsWith("✉️") ||
    trimmed.startsWith("🔍") ||
    trimmed.startsWith("🕓") ||
    PROFILE_LINK_RE.test(trimmed)
  );
}

/**
 * Parse a message into interleaved text + contact-card segments.
 * Devuelve null si no hay ninguna tarjeta parseable (el caller cae al siguiente detector).
 */
export function parseContactCardSegments(md: string): ContactSegment[] | null {
  if (!md.includes("👤 **")) return null;

  const segments: ContactSegment[] = [];
  let anyContact = false;
  const lines = md.split("\n");
  let currentTextLines: string[] = [];
  let currentContactLines: string[] = [];
  let inContactBlock = false;

  const flushText = () => {
    const text = currentTextLines.join("\n").trim();
    if (text) segments.push({ type: "text", text });
    currentTextLines = [];
  };

  const flushContact = () => {
    if (currentContactLines.length === 0) return;
    const contactMd = currentContactLines.join("\n");
    const parsed = parseContactCard(contactMd);
    if (parsed) {
      anyContact = true;
      segments.push({ type: "contact", contact: parsed });
    } else {
      // Fallback: render as text
      const text = contactMd.trim();
      if (text) segments.push({ type: "text", text });
    }
    currentContactLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("👤 **")) {
      // Starting a new contact block
      if (inContactBlock) {
        flushContact();
      } else {
        flushText();
      }
      inContactBlock = true;
      currentContactLines = [line];
    } else if (inContactBlock) {
      if (isContactBlockLine(trimmed)) {
        currentContactLines.push(line);
      } else {
        // End of contact block
        flushContact();
        inContactBlock = false;
        currentTextLines.push(line);
      }
    } else {
      currentTextLines.push(line);
    }
  }

  // Flush remaining
  if (inContactBlock) {
    flushContact();
  } else {
    flushText();
  }

  return anyContact ? segments : null;
}
