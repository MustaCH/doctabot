// Pure formatting helpers for the morning-matches messages (extracted from index.ts
// so they can be unit-tested with Vitest). No Deno/runtime imports — keep it pure TS.
import {
  extractTypeFromTitle,
  extractClientZonesFromNotes,
  type PropertyRow,
  type ClientRow,
} from "./matching.ts";

/** Calificación del cliente → etiqueta con emoji (frío/templado/caliente). */
const CLIENT_STATUS_LABELS: Record<string, string> = {
  hot: "🔥 Caliente",
  warm: "☀️ Templado",
  cold: "❄️ Frío",
};

export function buildClientSearchSummary(client: ClientRow): string {
  const parts: string[] = [];

  // Tipo
  const types = client.property_type_interest
    ?.split(",").map((t) => t.trim()).filter(Boolean) || [];
  if (types.length === 0 && client.notes) {
    const noteTypes = extractTypeFromTitle(client.notes);
    if (noteTypes.length) types.push(...noteTypes);
  }

  // Zonas
  const zones = client.preferred_zones
    ?.split(",").map((z) => z.trim()).filter(Boolean) || [];
  if (client.notes) {
    const noteZones = extractClientZonesFromNotes(client.notes);
    for (const z of noteZones) {
      if (!zones.some((ez) => ez.toLowerCase() === z)) zones.push(z);
    }
  }

  // Construir texto tipo + zona
  const typeStr = types.length
    ? types.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join("/")
    : null;
  const zoneStr = zones.length ? zones.join(", ") : null;
  if (typeStr && zoneStr) parts.push(`${typeStr} en ${zoneStr}`);
  else if (typeStr) parts.push(typeStr);
  else if (zoneStr) parts.push(`en ${zoneStr}`);

  // Presupuesto
  if (client.budget_max) {
    const curr = client.budget_currency || "USD";
    parts.push(`Hasta ${curr} ${client.budget_max.toLocaleString("es-AR")}`);
  } else if (client.budget_min) {
    // Legacy: single value stored in min = treat as max
    const curr = client.budget_currency || "USD";
    parts.push(`Hasta ${curr} ${client.budget_min.toLocaleString("es-AR")}`);
  }

  // Calificación del cliente (frío/templado/caliente)
  const calificacion = client.status ? CLIENT_STATUS_LABELS[client.status] : null;

  // Fallback: si no hay datos estructurados, usar notas
  if (parts.length === 0 && client.notes) {
    const base = `🔍 **Busca:** ${client.notes.substring(0, 100)}`;
    return calificacion ? `${base} · ${calificacion}` : base;
  }

  if (parts.length === 0) return "";
  if (calificacion) parts.push(calificacion);
  return `🔍 **Busca:** ${parts.join(" · ")}`;
}

export function formatPropertyLine(p: PropertyRow): string {
  const lines: string[] = [];
  if (p.title) lines.push(`🏠 **${p.title}**`);
  if (p.photo) lines.push(`![${p.title || "Propiedad"}](${p.photo})`);
  if (p.price) lines.push(`💰 ${p.currency || "USD"} ${p.price.toLocaleString("es-AR")}`);
  if (p.address) lines.push(`📍 ${p.address}`);
  const surfaceParts: string[] = [];
  if (p.m2_total) surfaceParts.push(`${p.m2_total} m²`);
  if (p.habitaciones) surfaceParts.push(`${p.habitaciones} dormitorio${p.habitaciones === 1 ? "" : "s"}`);
  if (surfaceParts.length) lines.push(`📐 ${surfaceParts.join(" · ")}`);
  if (p.url) lines.push(`🔗 [Ver propiedad](${p.url})`);
  return lines.join("\n");
}
