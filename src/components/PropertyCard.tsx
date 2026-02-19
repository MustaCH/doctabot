import { ExternalLink, Copy, Check, BadgeCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

const PropertyCard = ({ photo, title, office, price, location, surface, url, extras, agentCode }: PropertyCardProps) => {
  const finalUrl = url ? buildPropertyUrl(url, agentCode) : undefined;
  const isDocta = office?.toLowerCase().includes("docta") ?? false;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!finalUrl) return;
    await navigator.clipboard.writeText(finalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {photo && (
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          <img
            src={photo}
            alt={title ?? "Propiedad"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          {isDocta && (
            <Badge className="absolute top-2 left-2 gap-1 bg-primary text-primary-foreground shadow-md text-[10px] px-2 py-0.5">
              <BadgeCheck className="h-3 w-3" />
              RE/MAX Docta
            </Badge>
          )}
        </div>
      )}
      {!photo && isDocta && (
        <div className="px-3.5 pt-3">
          <Badge className="gap-1 bg-primary text-primary-foreground text-[10px] px-2 py-0.5">
            <BadgeCheck className="h-3 w-3" />
            RE/MAX Docta
          </Badge>
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
            <Button size="sm" variant="outline" className="h-9 w-9 p-0 shrink-0" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PropertyCard;
