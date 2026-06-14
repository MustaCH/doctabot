// Lógica pura de parsing de mensajes de Alan → tarjetas de propiedad.
// Extraída de PropertyCard.tsx (ticket 86aj18u8r) para desacoplarla del componente de UI
// y mejorar la testabilidad. Sin deps de React/lucide/hooks.
//
// OJO: depende de los marcadores de formato que emite el backend y parsea el front
// (🏠, ![](url), 💰, 📍, 📐, 🔗, 🏢). No tocar la lógica — ver src/lib/match-card-contract.test.ts.

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

    // Price
    if (line.startsWith("💰")) {
      price = line.replace(/^💰\s*/, "").replace(/^Precio:\s*/i, "");
      continue;
    }

    // Office
    if (line.startsWith("🏢")) {
      office = line.replace(/^🏢\s*/, "").replace(/^Oficina:\s*/i, "");
      continue;
    }

    // Location
    if (line.startsWith("📍")) {
      location = line.replace(/^📍\s*/, "").replace(/^Ubicación:\s*/i, "");
      continue;
    }

    // Surface
    if (line.startsWith("📐")) {
      surface = line.replace(/^📐\s*/, "").replace(/^Superficie:\s*/i, "");
      continue;
    }

    // Link: 🔗 [Ver propiedad](url)
    const linkMatch = line.match(/🔗\s*\[.*?\]\((.+?)\)/);
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

  for (const line of lines) {
    if (line.includes("🏠")) {
      // Starting a new property block
      if (inPropertyBlock) {
        flushProperty();
      } else {
        flushText();
      }
      inPropertyBlock = true;
      currentPropLines = [line];
    } else if (inPropertyBlock) {
      // Check if this line is still part of the property block (emoji-prefixed or empty)
      const trimmed = line.trim();
      if (
        trimmed === "" ||
        trimmed.startsWith("💰") ||
        trimmed.startsWith("📍") ||
        trimmed.startsWith("📐") ||
        trimmed.startsWith("🔗") ||
        trimmed.startsWith("🏢") ||
        /^!\[/.test(trimmed)
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
