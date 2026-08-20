import { cn } from "@/lib/utils";
import { CLIENT_STATUS_META, type ClientStatus } from "@/lib/client-status";

/** Chip de estado de cliente: punto de color de 5px + etiqueta, sin emoji.
    Devuelve null si el status no es hot|warm|cold. Data en src/lib/client-status.ts. */
export const ClientStatusChip = ({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) => {
  const meta = CLIENT_STATUS_META[(status ?? "") as ClientStatus];
  if (!meta) return null;
  return (
    <span
      data-testid="client-status-chip"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
        className
      )}
      style={{ background: meta.bg, borderColor: meta.border, color: meta.text }}
    >
      <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: meta.dot }} />
      {meta.label}
    </span>
  );
};
