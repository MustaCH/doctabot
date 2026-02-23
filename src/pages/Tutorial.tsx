import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import alanAvatar from "@/assets/alan-avatar.png";
import {
  Search,
  Star,
  Mic,
  FileText,
  MessageSquare,
  Users,
  CalendarCheck,
  Lightbulb,
  Rocket,
  ChevronRight,
  ChevronLeft,
  X,
} from "lucide-react";

interface TutorialStep {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  tips?: string[];
  example?: string;
}

const steps: TutorialStep[] = [
  {
    icon: <img src={alanAvatar} alt="Alan" className="h-16 w-16" />,
    title: "¡Hola! Soy Alan 👋",
    subtitle: "Tu asistente inmobiliario con IA",
    description:
      "Estoy diseñado para ayudarte a encontrar propiedades, gestionar clientes y organizar tu agenda. Todo desde una conversación natural, como si hablaras con un colega.",
  },
  {
    icon: <Search className="h-12 w-12 text-primary" />,
    title: "Buscá propiedades con lenguaje natural",
    subtitle: "Escribí como hablarías normalmente",
    description:
      "No necesitás filtros complicados. Simplemente escribí lo que buscás y Alan va a entender tu consulta.",
    example:
      '"Necesito departamentos de 2 ambientes en Nueva Córdoba, hasta 100.000 dólares"',
    tips: [
      "Podés especificar zona, tipo, precio, ambientes y más.",
      "Cuanto más específico seas, mejores resultados vas a obtener.",
    ],
  },
  {
    icon: <Star className="h-12 w-12 text-accent" />,
    title: "Guardá tus favoritos ⭐",
    subtitle: "Accedé rápido a las propiedades que te interesan",
    description:
      "Cuando Alan te muestre resultados, podés marcar propiedades como favoritas tocando el ícono de estrella. Todas se guardan en tu sección de Favoritos para acceder después.",
    tips: [
      "Usá favoritos para armar listas de propiedades para tus clientes.",
      "Accedé desde el menú lateral en cualquier momento.",
    ],
  },
  {
    icon: (
      <div className="flex gap-3">
        <Mic className="h-10 w-10 text-primary" />
        <FileText className="h-10 w-10 text-primary" />
      </div>
    ),
    title: "Hablá o subí archivos",
    subtitle: "Entrada por voz y procesamiento de PDFs",
    description:
      "¿Estás ocupado? Usá el micrófono para dictar tu consulta. ¿Tenés una ficha en PDF? Adjuntala y Alan la va a analizar automáticamente.",
    tips: [
      "El botón de micrófono transcribe tu voz a texto al instante.",
      "Los PDFs se procesan y Alan extrae la información relevante.",
    ],
  },
  {
    icon: <MessageSquare className="h-12 w-12 text-primary" />,
    title: "Organizá tus conversaciones",
    subtitle: "Un hilo para cada cliente o consulta",
    description:
      "Creá conversaciones separadas para cada cliente o zona. Así mantenés todo organizado y podés retomar cualquier búsqueda donde la dejaste.",
    tips: [
      'Tocá "+" para iniciar una nueva conversación.',
      "Deslizá a la izquierda sobre una conversación para eliminarla.",
      "Alan recuerda el contexto de cada hilo.",
    ],
  },
  {
    icon: <Users className="h-12 w-12 text-primary" />,
    title: "Gestioná tus clientes",
    subtitle: "Tu agenda de contactos integrada",
    description:
      "Desde la sección de Clientes podés agregar, editar y llevar un seguimiento de cada persona con la que trabajás. Agregá notas, teléfono y email.",
    tips: [
      "Podés vincular conversaciones a clientes específicos.",
      "Usá las notas para recordar preferencias de cada cliente.",
    ],
  },
  {
    icon: <CalendarCheck className="h-12 w-12 text-primary" />,
    title: "Conectá tu agenda",
    subtitle: "Google Calendar integrado",
    description:
      "Si conectaste tu Google Calendar, Alan puede crear eventos y recordatorios directamente en tu agenda. Ideal para visitas, seguimientos y reuniones.",
    tips: [
      "Podés conectar tu calendario desde tu Perfil.",
      'Pedile a Alan: "Agendame una visita el martes a las 15hs".',
    ],
  },
  {
    icon: <Lightbulb className="h-12 w-12 text-accent" />,
    title: "Consejos para sacarle el máximo provecho",
    subtitle: "Mejores prácticas",
    description: "Seguí estos tips para que Alan te ayude de la mejor manera posible:",
    tips: [
      "Sé específico: zona, presupuesto, tipo de propiedad.",
      "Usá hilos separados para distintos clientes.",
      "Aprovechá la voz cuando estés en movimiento.",
      "Revisá tus favoritos antes de reunirte con un cliente.",
    ],
  },
  {
    icon: <Rocket className="h-12 w-12 text-primary" />,
    title: "¡Todo listo! 🚀",
    subtitle: "Empezá a trabajar con Alan",
    description:
      "Ya conocés todas las herramientas. Es momento de comenzar tu primera conversación. ¿Qué propiedad necesitás encontrar hoy?",
  },
];

const Tutorial = () => {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const total = steps.length;
  const step = steps[current];
  const progress = ((current + 1) / total) * 100;

  const next = () => {
    if (current < total - 1) setCurrent((s) => s + 1);
    else finish();
  };

  const prev = () => {
    if (current > 0) setCurrent((s) => s - 1);
  };

  const finish = () => {
    localStorage.setItem("alan_tutorial_done", "1");
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/5 px-6">
      {/* Skip */}
      <button
        onClick={finish}
        className="absolute right-4 top-4 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Omitir <X className="h-3.5 w-3.5" />
      </button>

      <div className="w-full max-w-md space-y-6">
        {/* Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {current + 1} de {total}
            </span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        {/* Card */}
        <div
          key={current}
          className="animate-in fade-in slide-in-from-right-4 duration-300 rounded-xl border bg-card p-6 shadow-sm space-y-5"
        >
          {/* Icon */}
          <div className="flex justify-center">{step.icon}</div>

          {/* Text */}
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {step.title}
            </h1>
            <p className="text-sm font-medium text-primary">{step.subtitle}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {step.description}
            </p>
          </div>

          {/* Example */}
          {step.example && (
            <div className="rounded-lg bg-muted/60 px-4 py-3 text-sm italic text-foreground border border-border">
              {step.example}
            </div>
          )}

          {/* Tips */}
          {step.tips && step.tips.length > 0 && (
            <ul className="space-y-2">
              {step.tips.map((tip, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-muted-foreground"
                >
                  <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                  {tip}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-3">
          {current > 0 ? (
            <Button variant="ghost" size="sm" onClick={prev}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Atrás
            </Button>
          ) : (
            <div />
          )}

          <Button onClick={next} className="ml-auto">
            {current === total - 1 ? "Comenzar" : "Siguiente"}
            {current < total - 1 && <ChevronRight className="ml-1 h-4 w-4" />}
          </Button>
        </div>

        {/* Dots */}
        <div className="flex justify-center gap-1.5">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`h-2 w-2 rounded-full transition-all ${
                i === current
                  ? "bg-primary w-4"
                  : i < current
                  ? "bg-primary/50"
                  : "bg-border"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Tutorial;
