import { ExternalLink, Copy, Check, BadgeCheck, Home, Heart, Share2, Phone, Mail, MessageCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFavorite } from "@/hooks/use-favorite";
import type { PropertyCardProps } from "@/lib/property-card-parse";

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

const PropertyCard = ({ photo, title, office, price, location, surface, url, extras = [], agentCode, contactPhone, contactEmail, whatsappPhone }: PropertyCardProps) => {
  const finalUrl = url ? buildPropertyUrl(url, agentCode) : undefined;
  const isDocta = office?.toLowerCase().includes("docta") ?? false;
  const [copied, setCopied] = useState(false);
  const [imgError, setImgError] = useState(false);
  // Guardarraíl de disponibilidad: las fotos viven en el CDN de RE/MAX bajo el id del
  // listing; cuando una propiedad se da de baja, la imagen 404ea (imgError) y su URL
  // pública redirige a la home. Usamos el fallo de imagen como proxy de "baja" y NO
  // ofrecemos "Ver propiedad" (que llevaría a la home). Ver ticket 86aj42b7t.
  const unavailable = imgError;
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
        {finalUrl && unavailable && (
          <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <span aria-hidden>⚠️</span>
            <span>Propiedad no disponible</span>
          </div>
        )}
        {finalUrl && !unavailable && (
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
                aria-label="Compartir por WhatsApp"
                className="h-9 w-9 p-0 shrink-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                onClick={handleWhatsApp}
                disabled={!whatsappPhone}
              >
                <Share2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
        {(contactPhone || contactEmail) && (
          <div className="flex gap-2 pt-1">
            {contactPhone && (
              <a href={`https://wa.me/${contactPhone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950">
                  <MessageCircle className="h-3.5 w-3.5" />
                  WhatsApp
                </Button>
              </a>
            )}
            {contactPhone && (
              <a href={`tel:${contactPhone}`}>
                <Button size="sm" variant="outline" className="h-9 w-9 p-0 shrink-0">
                  <Phone className="h-3.5 w-3.5" />
                </Button>
              </a>
            )}
            {contactEmail && (
              <a href={`mailto:${contactEmail}`}>
                <Button size="sm" variant="outline" className="h-9 w-9 p-0 shrink-0">
                  <Mail className="h-3.5 w-3.5" />
                </Button>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PropertyCard;
