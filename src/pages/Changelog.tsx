import { ArrowLeft, Sparkles, Bug, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

type EntryType = "feature" | "fix" | "improvement";

interface ChangelogEntry {
  version: string;
  date: string;
  entries: { type: EntryType; text: string }[];
}

const typeConfig: Record<EntryType, { icon: typeof Sparkles; label: string; className: string }> = {
  feature: { icon: Sparkles, label: "Nuevo", className: "bg-green-500/15 text-green-700 dark:text-green-400" },
  fix: { icon: Bug, label: "Fix", className: "bg-red-500/15 text-red-700 dark:text-red-400" },
  improvement: { icon: Wrench, label: "Mejora", className: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
};

const changelog: ChangelogEntry[] = [
  {
    version: "1.5.0",
    date: "16 de marzo de 2026",
    entries: [
      { type: "feature", text: "Nuevos estados de cliente: 🔥 Caliente, ☀️ Tibio y ❄️ Frío con badges de colores" },
      { type: "feature", text: "Pull-to-refresh en Chat, Clientes y Dashboard" },
      { type: "improvement", text: "Auto-actualización de la PWA sin intervención del usuario" },
    ],
  },
  {
    version: "1.4.0",
    date: "16 de marzo de 2026",
    entries: [
      { type: "feature", text: "Alan ahora puede crear notas y tareas pendientes para clientes desde el chat" },
      { type: "feature", text: "Changelog visible en la app para ver novedades" },
      { type: "fix", text: "Corregido bug donde Alan mostraba el borrador de email dos veces después de enviarlo" },
      { type: "improvement", text: "Dashboard: boxes de estadísticas en 2 columnas en mobile para mejor legibilidad" },
    ],
  },
  {
    version: "1.3.0",
    date: "Marzo 2026",
    entries: [
      { type: "feature", text: "Ficha detallada de cliente con propiedades vinculadas, notas y línea de tiempo" },
      { type: "feature", text: "Eventos y fechas importantes de clientes con sincronización a Google Calendar" },
      { type: "feature", text: "Envío de emails desde Gmail a través de Alan" },
      { type: "feature", text: "Búsqueda web y scraping de URLs desde el chat" },
      { type: "improvement", text: "Capa de supervisión de calidad para las respuestas de Alan" },
    ],
  },
  {
    version: "1.2.0",
    date: "Febrero 2026",
    entries: [
      { type: "feature", text: "Google Calendar: crear, editar y eliminar eventos desde el chat" },
      { type: "feature", text: "Google Meet: crear videollamadas directamente desde Alan" },
      { type: "feature", text: "CRM enriquecido: presupuesto, zonas de interés, tipo de cliente, fuente" },
      { type: "feature", text: "Detección automática de datos de contacto en la conversación" },
      { type: "improvement", text: "Priorización de propiedades RE/MAX Docta en resultados" },
    ],
  },
  {
    version: "1.1.0",
    date: "Enero 2026",
    entries: [
      { type: "feature", text: "Mini-CRM: crear y gestionar perfiles de clientes desde el chat" },
      { type: "feature", text: "Vincular conversaciones a clientes automáticamente" },
      { type: "feature", text: "Favoritos: guardar y gestionar propiedades favoritas" },
      { type: "feature", text: "Generación de fichas/reportes de propiedades" },
    ],
  },
  {
    version: "1.0.0",
    date: "Diciembre 2025",
    entries: [
      { type: "feature", text: "Lanzamiento de Alan — Asistente inmobiliario IA para RE/MAX Docta" },
      { type: "feature", text: "Búsqueda inteligente de propiedades con filtros" },
      { type: "feature", text: "Comparación de propiedades lado a lado" },
      { type: "feature", text: "Soporte de audio: grabación y transcripción de mensajes de voz" },
      { type: "feature", text: "PWA instalable con actualizaciones automáticas" },
    ],
  },
];

const Changelog = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-gradient-to-br from-primary/10 via-background to-accent/5">
      <div className="mx-auto w-full max-w-lg px-4 py-6">
        <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold tracking-tight">Novedades</h1>
        </div>

        <div className="space-y-6">
          {changelog.map((release) => (
            <div key={release.version} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-bold text-foreground">v{release.version}</h2>
                <span className="text-xs text-muted-foreground">{release.date}</span>
              </div>
              <ul className="space-y-2">
                {release.entries.map((entry, i) => {
                  const config = typeConfig[entry.type];
                  const Icon = config.icon;
                  return (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold shrink-0 ${config.className}`}>
                        <Icon className="h-2.5 w-2.5" />
                        {config.label}
                      </span>
                      <span className="text-sm text-foreground/90">{entry.text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Changelog;
