import { ExternalLink, Copy, Check, BadgeCheck, Home, Heart, Share2, Phone, Mail, MessageCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFavorite } from "@/hooks/use-favorite";

interface PropertyCardProps {
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

function buildPropertyUrl(url: string, agentCode?: string | null): string {
  if (!agentCode) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("associate", agentCode);
    return u.toString();
  } catch {
    // fallback for relative or malformed URLs
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}associate=${encodeURIComponent(agentCode)}`;
  }
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

const PropertyCard = ({ photo, title, office, price, location, surface, url, extras, agentCode, contactPhone, contactEmail, whatsappPhone }: PropertyCardProps) => {
  const finalUrl = url ? buildPropertyUrl(url, agentCode) : undefined;
  const isDocta = office?.toLowerCase().includes("docta") ?? false;
  const [copied, setCopied] = useState(false);
  const [imgError, setImgError] = useState(false);
  const { isFavorite, toggle, loading: favLoading, canFavorite } = useFavorite(url);

  const handleCopy = async () => {
    if (!finalUrl) return;
    await navigator.clipboard.writeText(finalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsApp = () => {
    if (!finalUrl || !whatsappPhone) return;
    const lines = [
      title && `🏠 *${title}*`,
      price && `💰 ${price}`,
      location && `📍 ${location}`,
      surface && `📐 ${surface}`,
      `\n🔗 ${finalUrl}`,
    ].filter(Boolean);
    const text = lines.join("\n");
    const phone = whatsappPhone.replace(/\D/g, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  };
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {photo && !imgError ? (
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          <img
            src={photo}
            alt={title ?? "Propiedad"}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
          {isDocta && (
            <Badge className="absolute top-2 left-2 gap-1 bg-primary text-primary-foreground shadow-md text-[10px] px-2 py-0.5">
              <BadgeCheck className="h-3 w-3" />
              RE/MAX Docta
            </Badge>
          )}
          {canFavorite && (
            <button
              onClick={toggle}
              disabled={favLoading}
              className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm transition-colors hover:bg-black/50"
            >
              <Heart
                className={`h-3.5 w-3.5 transition-colors ${isFavorite ? "fill-red-500 text-red-500" : "text-white"}`}
              />
            </button>
          )}
        </div>
      ) : (
        <div className="relative flex aspect-video w-full items-center justify-center bg-muted">
          <Home className="h-12 w-12 text-muted-foreground/30" />
          {isDocta && (
            <Badge className="absolute top-2 left-2 gap-1 bg-primary text-primary-foreground shadow-md text-[10px] px-2 py-0.5">
              <BadgeCheck className="h-3 w-3" />
              RE/MAX Docta
            </Badge>
          )}
          {canFavorite && (
            <button
              onClick={toggle}
              disabled={favLoading}
              className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/10 dark:bg-white/10 backdrop-blur-sm transition-colors hover:bg-black/20"
            >
              <Heart
                className={`h-3.5 w-3.5 transition-colors ${isFavorite ? "fill-red-500 text-red-500" : "text-muted-foreground"}`}
              />
            </button>
          )}
        </div>
      )}
      <div className="space-y-2 p-3.5">
        {title && (
          <h3 className="text-sm font-semibold leading-snug">{title}</h3>
        )}
        {price && (
          <div className="flex items-center gap-1.5 text-sm">
            <span>💰</span>
            <span className="font-medium text-primary">{price}</span>
          </div>
        )}
        {location && (
          <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <span className="shrink-0">📍</span>
            <span>{location}</span>
          </div>
        )}
        {surface && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>📐</span>
            <span>{surface}</span>
          </div>
        )}
        {extras.map((line, i) => (
          <div key={i} className="text-sm text-muted-foreground">
            {line}
          </div>
        ))}
        {finalUrl && (
          <div className="flex gap-2 pt-1">
            <a href={finalUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
              <Button size="sm" variant="outline" className="w-full gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                Ver propiedad
              </Button>
            </a>
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-9 p-0 shrink-0"
              onClick={handleCopy}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            {whatsappPhone !== undefined && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 w-9 p-0 shrink-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                onClick={handleWhatsApp}
                disabled={!whatsappPhone}
              >
                <Share2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PropertyCard;
