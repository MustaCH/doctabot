import { Link } from "react-router-dom";
import { Phone, Mail, Search, UserRound, ChevronRight } from "lucide-react";
import { getInitials, getAvatarColorIndex, AVATAR_COLORS } from "@/lib/contact-avatar";
import { lastContactTone, type ContactCardProps } from "@/lib/contact-card-parse";
import { ClientStatusChip } from "@/components/ClientStatusChip";

// Tarjeta de contacto del chat (ticket 86ak3z07b) — hermana de PropertyCard: radio 18, vidrio,
// avatar 48 con AVATAR_COLORS, filas de datos con SVG a 15px, franja de último contacto con
// semáforo (lastContactTone) y acciones: Ver perfil primario (46, gradiente) + Llamar / WhatsApp
// como cuadrados de vidrio de 46. A partir del segundo contacto de un mensaje se usa
// ContactCardCompact (radio 16, avatar 44, toda la fila linkea al perfil) — mismo patrón que
// PropertyCard + PropertyCardCompact. Vive FUERA de la burbuja (ver ChatMessage.tsx).

type Tone = ReturnType<typeof lastContactTone>;

/** Semáforo de último contacto: verde <7 días / ámbar <30 / rojo ≥30 o nunca (README §2). */
const TONE: Record<Tone, { dot: string; text: string; bg: string; border: string }> = {
  green: { dot: "#3EC98A", text: "#3EC98A", bg: "rgba(62,201,138,0.09)", border: "rgba(62,201,138,0.26)" },
  amber: { dot: "#F5B23F", text: "#F5C46E", bg: "rgba(245,178,63,0.09)", border: "rgba(245,178,63,0.26)" },
  red: { dot: "#FF5A4D", text: "#FF9086", bg: "rgba(255,90,77,0.09)", border: "rgba(255,90,77,0.26)" },
};

const glassSquare =
  "flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px] border border-white/[0.09] bg-white/5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground";

/** Logo de WhatsApp en el verde de la plataforma (#25D366 — marca, no se toca). */
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="#25D366" className={className} aria-hidden="true">
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 2.1.55 4.06 1.6 5.8L2 22l4.42-1.68a9.9 9.9 0 0 0 5.62 1.72h.01c5.46 0 9.9-4.45 9.91-9.91A9.86 9.86 0 0 0 12.04 2zm5.8 14.02c-.25.7-1.44 1.33-2 1.42-.51.08-1.16.11-1.87-.12a16 16 0 0 1-1.7-.63c-2.98-1.29-4.93-4.29-5.08-4.49-.15-.2-1.22-1.61-1.22-3.08 0-1.46.77-2.18 1.04-2.48.27-.3.59-.37.79-.37h.57c.18 0 .43-.07.67.51.25.6.85 2.06.92 2.21.08.15.13.32.03.52-.1.2-.15.32-.3.5-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.3.77 1.27 1.65 2.05 1.14 1.01 2.1 1.32 2.4 1.47.3.15.47.13.64-.08.17-.2.74-.86.94-1.16.2-.3.4-.25.67-.15.27.1 1.72.81 2.01.96.3.15.5.22.57.35.07.13.07.75-.18 1.46z" />
  </svg>
);

const Avatar = ({ name, size }: { name: string; size: 44 | 48 }) => (
  <div
    aria-hidden="true"
    className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white tracking-[-0.02em] ${
      size === 48 ? "h-12 w-12 text-base shadow-[0_10px_24px_-12px_rgba(0,0,0,0.9)]" : "h-11 w-11 text-sm font-semibold"
    } ${AVATAR_COLORS[getAvatarColorIndex(name)]}`}
  >
    {getInitials(name)}
  </div>
);

/** Texto del último contacto: "Último contacto hace 12 días" / "Sin contacto registrado". */
function lastContactText(lastContactDays: number | null, lastContactLabel: string): { prefix: string; value: string | null } {
  if (lastContactDays === null) return { prefix: "Sin contacto registrado", value: null };
  return { prefix: "Último contacto", value: lastContactLabel };
}

/**
 * Fila compacta para listados (a partir del segundo contacto): avatar 44 + nombre + chip de
 * estado, la búsqueda en una línea truncada y el punto del último contacto. Toda la fila linkea
 * al perfil; sin botones.
 */
export const ContactCardCompact = ({ name, status, seeking, lastContactLabel, lastContactDays, profilePath }: ContactCardProps) => {
  const tone = TONE[lastContactTone(lastContactDays)];
  const lc = lastContactText(lastContactDays, lastContactLabel);

  const row = (
    <div
      data-testid="contact-card-compact"
      className="flex w-full items-center gap-3 rounded-[16px] border border-white/[0.09] bg-white/5 py-2.5 pl-2.5 pr-3 shadow-[0_16px_34px_-22px_rgba(0,0,0,0.9)] transition-colors hover:bg-white/[0.07]"
    >
      <Avatar name={name} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
          {status && <ClientStatusChip status={status} className="shrink-0" />}
        </div>
        {seeking && <p className="mt-1 truncate text-xs text-muted-foreground">{seeking}</p>}
        <div className="mt-[5px] flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.dot }} />
          <span className="text-[11px] text-muted-foreground">
            {lc.prefix}
            {lc.value ? ` ${lc.value}` : ""}
          </span>
        </div>
      </div>
      {profilePath && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/80" strokeWidth={1.9} aria-hidden="true" />}
    </div>
  );

  return profilePath ? (
    <Link to={profilePath} className="block w-full" title={`Ver perfil de ${name}`}>
      {row}
    </Link>
  ) : (
    row
  );
};

const ContactCard = ({ name, typeLabel, status, phone, email, seeking, lastContactLabel, lastContactDays, profilePath }: ContactCardProps) => {
  const tone = TONE[lastContactTone(lastContactDays)];
  const lc = lastContactText(lastContactDays, lastContactLabel);
  const waDigits = phone?.replace(/\D/g, "");
  // tel: sin espacios/guiones/paréntesis (conserva el + si lo trae; no inventa prefijo de país)
  const telHref = phone ? `tel:${phone.replace(/[\s()-]/g, "")}` : undefined;
  const hasData = !!(seeking || phone || email);
  const hasActions = !!(profilePath || phone);

  return (
    <div
      data-testid="contact-card"
      className="overflow-hidden rounded-[18px] border border-white/[0.09] bg-white/5 p-4 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)]"
    >
      {/* Cabecera: avatar 48 + nombre 17/600 + chips de tipo y estado */}
      <div className="flex items-center gap-[13px]">
        <Avatar name={name} size={48} />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[17px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground">{name}</h3>
          {(typeLabel || status) && (
            <div className="mt-[7px] flex flex-wrap items-center gap-[7px]">
              {typeLabel && (
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-[9px] py-[3px] text-[10px] font-semibold text-muted-foreground">
                  {typeLabel}
                </span>
              )}
              {status && <ClientStatusChip status={status} />}
            </div>
          )}
        </div>
      </div>

      {/* Datos: búsqueda primero, después teléfono, después email — solo si el server mandó el dato */}
      {hasData && (
        <div className="mt-[15px] space-y-[9px] border-t border-white/[0.07] pt-3.5">
          {seeking && (
            <div className="flex items-start gap-2.5">
              <Search className="mt-0.5 h-[15px] w-[15px] shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
              <p className="text-sm leading-[1.45] text-foreground/90">{seeking}</p>
            </div>
          )}
          {phone && (
            <div className="flex items-center gap-2.5">
              <Phone className="h-[15px] w-[15px] shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
              <p className="text-sm text-foreground/80 [font-variant-numeric:tabular-nums]">{phone}</p>
            </div>
          )}
          {email && (
            <div className="flex items-center gap-2.5">
              <Mail className="h-[15px] w-[15px] shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
              <p className="truncate text-sm text-foreground/80">{email}</p>
            </div>
          )}
        </div>
      )}

      {/* Último contacto: franja con semáforo */}
      <div
        data-testid="contact-last-contact"
        data-tone={lastContactTone(lastContactDays)}
        className="mt-3.5 flex items-center gap-[9px] rounded-[12px] border px-[13px] py-2.5"
        style={{ background: tone.bg, borderColor: tone.border }}
      >
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone.dot, boxShadow: `0 0 0 3px ${tone.bg}` }} />
        <span className="text-xs" style={{ color: tone.text }}>
          {lc.prefix}
          {lc.value && (
            <>
              {" "}
              <strong className="font-semibold">{lc.value}</strong>
            </>
          )}
        </span>
      </div>

      {/* Acciones: Ver perfil primario + Llamar / WhatsApp. Sin teléfono, Ver perfil ocupa todo el ancho. */}
      {hasActions && (
        <div className="mt-3.5 flex gap-2.5">
          {profilePath && (
            <Link
              to={profilePath}
              className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-[linear-gradient(150deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-sm font-semibold text-white shadow-[0_12px_28px_-14px_rgba(59,123,255,0.9)] transition-opacity hover:opacity-90"
            >
              <UserRound className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
              Ver perfil
            </Link>
          )}
          {phone && (
            <a href={telHref} className={glassSquare} aria-label={`Llamar a ${name}`} title="Llamar">
              <Phone className="h-[17px] w-[17px]" strokeWidth={1.7} aria-hidden="true" />
            </a>
          )}
          {waDigits && (
            <a
              href={`https://wa.me/${waDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              className={glassSquare}
              aria-label={`Escribir por WhatsApp a ${name}`}
              title="WhatsApp"
            >
              <WhatsAppIcon className="h-[17px] w-[17px]" />
            </a>
          )}
        </div>
      )}
    </div>
  );
};

export default ContactCard;
