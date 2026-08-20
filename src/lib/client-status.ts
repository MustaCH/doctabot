// Estados de cliente sin emoji (rediseño Carbón & Vidrio, ticket 86ak3kddg):
// punto de color + etiqueta. Los enums de DB siguen siendo hot|warm|cold —
// esto es SOLO presentación. Colores tabulados en el README del rediseño §2.
export type ClientStatus = "hot" | "warm" | "cold";

export const CLIENT_STATUS_META: Record<
  ClientStatus,
  { label: string; plural: string; dot: string; text: string; bg: string; border: string }
> = {
  hot: {
    label: "Caliente",
    plural: "Calientes",
    dot: "#FF5A4D",
    text: "#FF9086",
    bg: "rgba(255,90,77,0.16)",
    border: "rgba(255,90,77,0.32)",
  },
  warm: {
    label: "Tibio",
    plural: "Tibios",
    dot: "#F5B23F",
    text: "#F5C46E",
    bg: "rgba(245,178,63,0.16)",
    border: "rgba(245,178,63,0.32)",
  },
  cold: {
    label: "Frío",
    plural: "Fríos",
    dot: "#4FC3E8",
    text: "#82D5F0",
    bg: "rgba(79,195,232,0.16)",
    border: "rgba(79,195,232,0.32)",
  },
};

export const CLIENT_TYPE_LABEL: Record<string, string> = {
  buyer: "Comprador",
  seller: "Vendedor",
  both: "Ambos",
};

/** Etiqueta en español del estado, sin emoji. Devuelve el valor crudo si no es hot|warm|cold. */
export function clientStatusLabel(status: string | null | undefined): string {
  return CLIENT_STATUS_META[(status ?? "") as ClientStatus]?.label ?? (status || "—");
}
