// Lógica pura de parsing de mensajes de Alan → tarjetas de propiedad.
// Extraída de PropertyCard.tsx (ticket 86aj18u8r) para desacoplarla del componente de UI
// y mejorar la testabilidad. Sin deps de React/lucide/hooks.
//
// OJO: depende del formato que emite el backend (card-render.ts). Desde el rediseño
// (ticket 86ak3kcx3) el server emite líneas rotuladas (Oficina:/Precio:/Ubicación:/
// Superficie:/[Ver propiedad](url)) y solo conserva el 🏠 del título como marcador de
// bloque. Los mensajes VIEJOS persistidos en DB siguen con 💰 📍 📐 🏢 🔗 — este parser
// tolera AMBOS formatos. Ver src/lib/match-card-contract.test.ts.

export interface PropertyCardProps {
  photo?: string;
  title?: string;
  office?: string;
  price?: string;
  location?: string;
  surface?: string;
  url?: string;
  extras?: string[];
  agentCode?: string | null;
  contactPhone?: string;
  contactEmail?: string;
  /** If provided, shows a WhatsApp share button targeting this phone number. Empty string = disabled button. */
  whatsappPhone?: string;
}

/** Try to parse a markdown block into structured property data */
export function parsePropertyCard(md: string): PropertyCardProps | null {
  // For multi-card messages, don't parse as single card
  const houseCount = (md.match(/🏠/g) || []).length;
  if (houseCount > 1) return null;
  // Must have at least a title line with 🏠
  if (!md.includes("🏠")) return null;

  let photo: string | undefined;
  let title: string | undefined;
  let office: string | undefined;
  let price: string | undefined;
  let location: string | undefined;
  let surface: string | undefined;
  let url: string | undefined;
  const extras: string[] = [];

  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Photo: ![alt](url)
    const imgMatch = line.match(/^!\[.*?\]\((.+?)\)$/);
    if (imgMatch) {
      photo = imgMatch[1];
      continue;
    }

    // Title: 🏠 **Title**
    const titleMatch = line.match(/🏠\s*\*\*(.+?)\*\*/);
    if (titleMatch) {
      title = titleMatch[1];
      continue;
    }

    // Price — formato nuevo "Precio: …" o viejo "💰 Precio: …"
    if (line.startsWith("💰") || /^Precio:/i.test(line)) {
      price = line.replace(/^💰\s*/, "").replace(/^Precio:\s*/i, "");
      continue;
    }

    // Office — "Oficina: …" o "🏢 …"
    if (line.startsWith("🏢") || /^Oficina:/i.test(line)) {
      office = line.replace(/^🏢\s*/, "").replace(/^Oficina:\s*/i, "");
      continue;
    }

    // Location — "Ubicación: …" o "📍 …"
    if (line.startsWith("📍") || /^Ubicaci[oó]n:/i.test(line)) {
      location = line.replace(/^📍\s*/, "").replace(/^Ubicaci[oó]n:\s*/i, "");
      continue;
    }

    // Surface — "Superficie: …" o "📐 …"
    if (line.startsWith("📐") || /^Superficie:/i.test(line)) {
      surface = line.replace(/^📐\s*/, "").replace(/^Superficie:\s*/i, "");
      continue;
    }

    // Link: "[Ver propiedad](url)" (nuevo) o "🔗 […](url)" (viejo)
    const linkMatch = line.match(/^🔗\s*\[.*?\]\((.+?)\)/) ?? line.match(/^\[Ver propiedad\]\((.+?)\)$/i);
    if (linkMatch) {
      url = linkMatch[1];
      continue;
    }

    // Any other emoji-prefixed line
    if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(line)) {
      extras.push(line);
      continue;
    }
  }

  if (!title) return null;
  return { photo, title, office, price, location, surface, url, extras };
}

/** Parse a message with multiple property blocks (each starting with 🏠) into segments */
export interface ContentSegment {
  type: "text" | "property";
  text?: string;
  property?: PropertyCardProps;
}

export function parseMultiplePropertyCards(md: string): ContentSegment[] | null {
  const houseCount = (md.match(/🏠/g) || []).length;
  if (houseCount < 2) return null;

  const segments: ContentSegment[] = [];
  // Split by lines, group into property blocks and text blocks
  const lines = md.split("\n");
  let currentTextLines: string[] = [];
  let currentPropLines: string[] = [];
  let inPropertyBlock = false;

  const flushText = () => {
    const text = currentTextLines.join("\n").trim();
    if (text) segments.push({ type: "text", text });
    currentTextLines = [];
  };

  const flushProperty = () => {
    if (currentPropLines.length === 0) return;
    const propMd = currentPropLines.join("\n");
    const parsed = parsePropertyCard(propMd);
    if (parsed) {
      segments.push({ type: "property", property: parsed });
    } else {
      // Fallback: render as text
      const text = propMd.trim();
      if (text) segments.push({ type: "text", text });
    }
    currentPropLines = [];
  };

  const isImageLine = (s: string | undefined) => !!s && /^!\[.*?\]\(.+?\)$/.test(s.trim());

  for (const line of lines) {
    if (line.includes("🏠")) {
      // Starting a new property block. En el formato del chat la FOTO viene en la línea
      // anterior al título 🏠: si quedó colgada en el texto (o pegada al final del bloque
      // anterior), se arrastra a este bloque para que cada tarjeta conserve SU foto.
      let carriedPhoto: string | null = null;
      if (inPropertyBlock) {
        const last = currentPropLines[currentPropLines.length - 1];
        if (isImageLine(last)) carriedPhoto = currentPropLines.pop()!;
        flushProperty();
      } else {
        const prev = currentTextLines[currentTextLines.length - 1];
        if (isImageLine(prev)) carriedPhoto = currentTextLines.pop()!;
        flushText();
      }
      inPropertyBlock = true;
      currentPropLines = carriedPhoto ? [carriedPhoto, line] : [line];
    } else if (inPropertyBlock) {
      // Check if this line is still part of the property block: vacía, foto, línea
      // emoji del formato viejo, o línea rotulada del formato nuevo.
      const trimmed = line.trim();
      if (
        trimmed === "" ||
        trimmed.startsWith("💰") ||
        trimmed.startsWith("📍") ||
        trimmed.startsWith("📐") ||
        trimmed.startsWith("🔗") ||
        trimmed.startsWith("🏢") ||
        /^!\[/.test(trimmed) ||
        /^(Precio|Oficina|Ubicaci[oó]n|Superficie|Expensas):/i.test(trimmed) ||
        /^\[Ver propiedad\]\(/i.test(trimmed)
      ) {
        currentPropLines.push(line);
      } else {
        // End of property block
        flushProperty();
        inPropertyBlock = false;
        currentTextLines.push(line);
      }
    } else {
      currentTextLines.push(line);
    }
  }

  // Flush remaining
  if (inPropertyBlock) {
    flushProperty();
  } else {
    flushText();
  }

  return segments.length > 0 ? segments : null;
}
