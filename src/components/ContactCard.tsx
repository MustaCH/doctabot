import { Link } from "react-router-dom";
import { Phone, MessageCircle, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getInitials, getAvatarColorIndex, AVATAR_COLORS } from "@/lib/contact-avatar";
import { lastContactTone, type ContactCardProps } from "@/lib/contact-card-parse";

// Mismos estilos de chips que ClientDetail/Clients (statusColor / chip de tipo en muted).
const statusChipCls: Record<string, string> = {
  hot: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  warm: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  cold: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
};
const statusChipLabel: Record<string, string> = {
  hot: "🔥 Caliente", warm: "🟡 Tibio", cold: "❄️ Frío",
};

const toneDotCls: Record<ReturnType<typeof lastContactTone>, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

const ContactCard = ({ name, typeLabel, status, phone, email, seeking, lastContactLabel, lastContactDays, profilePath }: ContactCardProps) => {
  const tone = lastContactTone(lastContactDays);
  const waDigits = phone?.replace(/\D/g, "");

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="space-y-2 p-3.5">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${AVATAR_COLORS[getAvatarColorIndex(name)]}`}
          >
            {getInitials(name)}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-snug break-words">{name}</h3>
            {(typeLabel || status) && (
              <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                {typeLabel && (
                  <span className="inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] font-medium h-5 text-muted-foreground">
                    {typeLabel}
                  </span>
                )}
                {status && (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium h-5 ${statusChipCls[status]}`}>
                    {statusChipLabel[status]}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {phone && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>📱</span>
            <span className="break-all">{phone}</span>
          </div>
        )}
        {email && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>✉️</span>
            <span className="break-all">{email}</span>
          </div>
        )}
        {seeking && (
          <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <span className="shrink-0">🔍</span>
            <span>{seeking}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`h-2 w-2 shrink-0 rounded-full ${toneDotCls[tone]}`} aria-hidden />
          <span>Último contacto: {lastContactLabel}</span>
        </div>
        {(phone || profilePath) && (
          <div className="flex gap-2 pt-1">
            {phone && (
              <a href={`tel:${phone}`} className="flex-1">
                <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs">
                  <Phone className="h-3.5 w-3.5" />
                  Llamar
                </Button>
              </a>
            )}
            {waDigits && (
              <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950">
                  <MessageCircle className="h-3.5 w-3.5" />
                  WhatsApp
                </Button>
              </a>
            )}
            {profilePath && (
              <Link to={profilePath} className="flex-1">
                <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs">
                  <UserRound className="h-3.5 w-3.5" />
                  Ver perfil
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContactCard;
