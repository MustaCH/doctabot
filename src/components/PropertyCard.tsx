import { ExternalLink, Copy, Check, BadgeCheck, Home, Heart, Share2, Phone, Mail, MessageCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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

/** Datos secundarios como chips: "62 m² totales (2 hab · 1 baños)" → ["62 m² totales", "2 hab", "1 baños"].
    Las líneas extra emoji-prefijadas pierden el emoji (el rediseño no usa emojis como iconos). */
function buildChips(surface?: string, extras: string[] = [], office?: string, isDocta?: boolean): string[] {
  const chips: string[] = [];
  if (surface) {
    const parens = surface.match(/^(.*?)\s*\((.*)\)\s*$/);
    if (parens) {
      chips.push(parens[1].trim());
      chips.push(...parens[2].split("·").map((s) => s.trim()).filter(Boolean));
    } else {
      chips.push(surface.trim());
    }
  }
  for (const line of extras) {
    const clean = line.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}️\s]+/u, "").trim();
    if (clean) chips.push(clean);
  }
  if (office && !isDocta) chips.push(office);
  return chips.filter(Boolean);
}

const glassSquare =
  "flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px] border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-50";

/**
 * Variante compacta para listados de varios resultados (artboard Resultados): la primera
 * propiedad va con la tarjeta completa y el resto con esta — miniatura 84px + título +
 * precio tabular + una línea de datos (~104px de alto). Sin botones: la tarjeta entera
 * linkea a la propiedad. El badge de % de match solo aparece si `matchPercent` viene
 * definido (depende del spike de property-matching; sin número presentable no se muestra
 * ni reserva espacio).
 */
export const PropertyCardCompact = ({ photo, title, office, price, surface, url, extras = [], agentCode, matchPercent }: PropertyCardProps & { matchPercent?: number }) => {
  const finalUrl = url ? buildPropertyUrl(url, agentCode) : undefined;
  const isDocta = office?.toLowerCase().includes("docta") ?? false;
  const [imgError, setImgError] = useState(false);
  const meta = buildChips(surface, extras).slice(0, 2).join(" · ");

  const card = (
    <div
      data-testid="property-card-compact"
      className="flex w-full items-center gap-3 rounded-[16px] border border-white/[0.09] bg-white/5 p-2.5 shadow-[0_16px_34px_-22px_rgba(0,0,0,0.9)]"
    >
      <div className="relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-[10px] bg-muted">
        {photo && !imgError ? (
          <img
            src={photo}
            alt={title ?? "Propiedad"}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Home className="h-7 w-7 text-muted-foreground/30" />
          </div>
        )}
        {isDocta && (
          <span
            data-testid="docta-dot"
            className="absolute top-1.5 left-1.5 h-2 w-2 rounded-full bg-[hsl(var(--accent))] ring-2 ring-[rgba(19,21,25,0.7)]"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {isDocta && (
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--accent-soft-foreground))]">
            RE/MAX Docta
          </p>
        )}
        {title && <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-foreground">{title}</p>}
        {(price || meta) && (
          <div className="mt-1 flex min-w-0 items-baseline gap-2">
            {price && (
              <span className="shrink-0 text-base font-bold tracking-tight text-white [font-variant-numeric:tabular-nums]">
                {price}
              </span>
            )}
            {meta && <span className="truncate text-[11px] text-muted-foreground [font-variant-numeric:tabular-nums]">{meta}</span>}
          </div>
        )}
      </div>
      {typeof matchPercent === "number" && (
        <span className="shrink-0 self-center rounded-lg border border-[rgba(91,147,255,0.35)] bg-[rgba(91,147,255,0.18)] px-2 py-1 text-[10px] font-semibold text-[hsl(var(--primary-soft-foreground))]">
          {matchPercent}%
        </span>
      )}
    </div>
  );

  return finalUrl ? (
    <a href={finalUrl} target="_blank" rel="noopener noreferrer" className="block w-full">
      {card}
    </a>
  ) : (
    card
  );
};

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

  const chips = buildChips(surface, extras, office, isDocta);

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
    <div data-testid="property-card" className="w-full overflow-hidden rounded-[18px] border border-white/10 bg-white/5 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)]">
      <div className="relative aspect-[356/208] w-full overflow-hidden bg-muted">
        {photo && !imgError ? (
          <img
            src={photo}
            alt={title ?? "Propiedad"}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Home className="h-12 w-12 text-muted-foreground/30" />
          </div>
        )}
        {/* Degradado de oscurecimiento: legibilidad del precio y los controles sobre la foto */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(19,21,25,0.55) 0%, rgba(19,21,25,0) 34%, rgba(19,21,25,0.15) 58%, rgba(19,21,25,0.92) 100%)",
          }}
        />
        {isDocta && (
          <span className="absolute top-3.5 left-3.5 flex items-center gap-1.5 rounded-full border border-accent/60 bg-[rgba(19,21,25,0.55)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--accent-soft-foreground))]">
            <BadgeCheck className="h-3 w-3" />
            RE/MAX Docta
          </span>
        )}
        {canFavorite && (
          <button
            onClick={toggle}
            disabled={favLoading}
            aria-label={isFavorite ? "Quitar de favoritos" : "Guardar en favoritos"}
            className="absolute top-3 right-3 flex h-[38px] w-[38px] items-center justify-center rounded-full border border-white/10 bg-[rgba(19,21,25,0.5)] backdrop-blur-sm transition-colors hover:bg-[rgba(19,21,25,0.7)]"
          >
            <Heart className={`h-4 w-4 transition-colors ${isFavorite ? "fill-red-500 text-red-500" : "text-white"}`} />
          </button>
        )}
        {(price || location) && (
          <div className="absolute left-4 right-4 bottom-3.5 min-w-0">
            {price && (
              <p className="text-[26px] font-bold leading-none tracking-tight text-white [font-variant-numeric:tabular-nums]">
                {price}
              </p>
            )}
            {location && <p className="mt-1.5 truncate text-xs leading-tight text-[#B9C0CB]">{location}</p>}
          </div>
        )}
      </div>

      <div className="p-4">
        {title && <h3 className="mb-3 text-[15px] font-medium leading-snug text-foreground">{title}</h3>}
        {chips.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {chips.map((chip, i) => (
              <span
                key={i}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[hsl(var(--foreground))]/80 [font-variant-numeric:tabular-nums]"
              >
                {chip}
              </span>
            ))}
          </div>
        )}
        {finalUrl && unavailable && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
            <span>Propiedad no disponible</span>
          </div>
        )}
        {finalUrl && !unavailable && (
          <div className="flex gap-2.5">
            <a href={finalUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
              <button className="flex h-[46px] w-full items-center justify-center gap-2 rounded-[14px] bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--primary-deep))] text-sm font-semibold text-white shadow-[0_12px_28px_-14px_rgba(59,123,255,0.9)] transition-opacity hover:opacity-90">
                Ver propiedad
                <ExternalLink className="h-4 w-4" />
              </button>
            </a>
            <button onClick={handleCopy} aria-label="Copiar link" className={glassSquare}>
              {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            </button>
            {whatsappPhone !== undefined && (
              <button
                aria-label="Compartir por WhatsApp"
                className={glassSquare}
                onClick={handleWhatsApp}
                disabled={!whatsappPhone}
              >
                <Share2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        {(contactPhone || contactEmail) && (
          <div className="mt-2.5 flex gap-2.5">
            {contactPhone && (
              <a href={`https://wa.me/${contactPhone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
                <Button size="sm" variant="outline" className="h-[46px] w-full gap-1.5 rounded-[14px] text-xs">
                  <MessageCircle className="h-3.5 w-3.5" />
                  WhatsApp
                </Button>
              </a>
            )}
            {contactPhone && (
              <a href={`tel:${contactPhone}`} aria-label="Llamar">
                <button className={glassSquare}>
                  <Phone className="h-4 w-4" />
                </button>
              </a>
            )}
            {contactEmail && (
              <a href={`mailto:${contactEmail}`} aria-label="Enviar email">
                <button className={glassSquare}>
                  <Mail className="h-4 w-4" />
                </button>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PropertyCard;
