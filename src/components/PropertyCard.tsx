import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PropertyCardProps {
  photo?: string;
  title?: string;
  price?: string;
  location?: string;
  surface?: string;
  url?: string;
  extras?: string[];
}

/** Try to parse a markdown block into structured property data */
export function parsePropertyCard(md: string): PropertyCardProps | null {
  // Must have at least a title line with 🏠
  if (!md.includes("🏠")) return null;

  let photo: string | undefined;
  let title: string | undefined;
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
  return { photo, title, price, location, surface, url, extras };
}

const PropertyCard = ({ photo, title, price, location, surface, url, extras }: PropertyCardProps) => {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {photo && (
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <img
            src={photo}
            alt={title ?? "Propiedad"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
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
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="block pt-1">
            <Button size="sm" variant="outline" className="w-full gap-2">
              <ExternalLink className="h-3.5 w-3.5" />
              Ver propiedad
            </Button>
          </a>
        )}
      </div>
    </div>
  );
};

export default PropertyCard;
