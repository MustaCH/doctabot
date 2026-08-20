import { ArrowLeft, Sparkles, Bug, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

type EntryType = "feature" | "fix" | "improvement";

interface ChangelogEntry {
  version: string;
  date: string;
  entries: { type: EntryType; text: string }[];
}

/* Chips Nuevo / Fix / Mejora — colores del rediseño (#3EC98A / #FF9086 / #9EC0FF), ícono SVG (lucide). */
const typeConfig: Record<EntryType, { icon: typeof Sparkles; label: string; className: string }> = {
  feature: { icon: Sparkles, label: "Nuevo", className: "border-[rgba(62,201,138,0.30)] bg-[rgba(62,201,138,0.14)] text-[#3EC98A]" },
  fix: { icon: Bug, label: "Fix", className: "border-[rgba(255,90,77,0.32)] bg-[rgba(255,90,77,0.16)] text-[#FF9086]" },
  improvement: { icon: Wrench, label: "Mejora", className: "border-[rgba(91,147,255,0.32)] bg-[rgba(91,147,255,0.16)] text-[#9EC0FF]" },
};

const changelog: ChangelogEntry[] = [
  {
    version: "1.8.7",
    date: "14 de abril de 2026",
    entries: [
      { type: "improvement", text: "Mejorado el emparejamiento de propiedades con clientes" },
      { type: "improvement", text: "Motor de búsqueda flexible a las tildes" },
      { type: "improvement", text: "Mejorado el método de búsqueda de propiedades en portales externos: ZonaProp, ArgenProp" },
      { type: "improvement", text: "Mejorada la importación y mapeo de clientes y su información vía archivos xlsx o csv" },
      { type: "feature", text: "Botón \"Enviar por WhatsApp\" para las plantillas de mensajes redactados por Alan. Redirige al usuario a WhatsApp con el mensaje listo para enviar" },
      { type: "feature", text: "Mensajes en segundo plano: ahora podés salir de la conversación mientras Alan elabora la respuesta y volver cuando te notifique que contestó" },
      { type: "feature", text: "Matching de propiedades automático: todos los días a las 9 AM Alan hace un barrido de la base de datos y te avisa si hay nuevas coincidencias" },
      { type: "feature", text: "Botón activar notificaciones: Alan ahora envía notificaciones push en tiempo real para tareas proactivas o programadas" },
    ],
  },
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
    <div className="flex min-h-[100dvh] flex-col bg-background">
      {/* Header estándar */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 safe-top">
        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => navigate(-1)} aria-label="Volver">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-base font-semibold tracking-tight">Novedades</h1>
      </div>

      <div className="mx-auto w-full max-w-lg px-4 pb-8 pt-4 safe-bottom">
        <div className="space-y-3.5">
          {changelog.map((release) => (
            <section key={release.version} aria-labelledby={`release-${release.version}`} className="rounded-[18px] border border-white/[0.09] bg-white/5 p-4">
              <div className="mb-3.5 flex items-baseline justify-between gap-3">
                <h2 id={`release-${release.version}`} className="text-lg font-bold tracking-[-0.025em] text-foreground">v{release.version}</h2>
                <span className="shrink-0 text-[11px] text-muted-foreground">{release.date}</span>
              </div>
              <ul className="space-y-[11px]">
                {release.entries.map((entry, i) => {
                  const config = typeConfig[entry.type];
                  const Icon = config.icon;
                  return (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className={`mt-0.5 inline-flex shrink-0 items-center gap-[5px] rounded-[8px] border px-2 py-[3px] text-[10px] font-semibold ${config.className}`}>
                        <Icon className="h-2.5 w-2.5" strokeWidth={2.2} aria-hidden="true" />
                        {config.label}
                      </span>
                      <span className="text-[13px] leading-[1.5] text-foreground/90">{entry.text}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Changelog;
