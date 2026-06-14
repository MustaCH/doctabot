import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
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

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 200 : -200,
    opacity: 0,
    scale: 0.95,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -200 : 200,
    opacity: 0,
    scale: 0.95,
  }),
};

const iconVariants = {
  hidden: { scale: 0, rotate: -20 },
  visible: {
    scale: 1,
    rotate: 0,
    transition: { type: "spring" as const, stiffness: 260, damping: 20, delay: 0.15 },
  },
};

const staggerContainer = {
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.25 },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const Tutorial = () => {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(0);
  const total = steps.length;
  const step = steps[current];
  const progress = ((current + 1) / total) * 100;

  const paginate = (newDirection: number) => {
    const next = current + newDirection;
    if (next < 0 || next >= total) {
      if (next >= total) finish();
      return;
    }
    setDirection(newDirection);
    setCurrent(next);
  };

  const jumpTo = (index: number) => {
    setDirection(index > current ? 1 : -1);
    setCurrent(index);
  };

  const finish = () => {
    localStorage.setItem("alan_tutorial_done", "1");
    navigate("/", { replace: true });
  };

  return (
    <div className="relative flex min-h-[var(--app-height,100dvh)] flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/5 px-6 overflow-hidden safe-top safe-bottom">
      {/* Skip */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        onClick={finish}
        className="absolute right-4 top-[calc(env(safe-area-inset-top,0px)+1rem)] flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors z-10"
      >
        Omitir <X className="h-3.5 w-3.5" />
      </motion.button>

      <div className="w-full max-w-md space-y-6">
        {/* Progress */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-2"
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{current + 1} de {total}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </motion.div>

        {/* Card with AnimatePresence */}
        <div className="relative min-h-[380px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={current}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.3}
              onDragEnd={(_e, { offset, velocity }) => {
                const swipe = Math.abs(offset.x) * velocity.x;
                if (swipe < -5000 || offset.x < -80) {
                  paginate(1);
                } else if (swipe > 5000 || offset.x > 80) {
                  paginate(-1);
                }
              }}
              transition={{ type: "spring" as const, stiffness: 300, damping: 30 }}
              className="rounded-xl border bg-card p-6 shadow-sm space-y-5 cursor-grab active:cursor-grabbing touch-pan-y"
            >
              {/* Icon */}
              <motion.div
                className="flex justify-center"
                variants={iconVariants}
                initial="hidden"
                animate="visible"
              >
                {step.icon}
              </motion.div>

              {/* Text */}
              <motion.div
                className="space-y-2 text-center"
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
              >
                <motion.h1
                  variants={staggerItem}
                  className="text-xl font-bold tracking-tight text-foreground"
                >
                  {step.title}
                </motion.h1>
                <motion.p
                  variants={staggerItem}
                  className="text-sm font-medium text-primary"
                >
                  {step.subtitle}
                </motion.p>
                <motion.p
                  variants={staggerItem}
                  className="text-sm text-muted-foreground leading-relaxed"
                >
                  {step.description}
                </motion.p>
              </motion.div>

              {/* Example */}
              {step.example && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, duration: 0.3 }}
                  className="rounded-lg bg-muted/60 px-4 py-3 text-sm italic text-foreground border border-border"
                >
                  {step.example}
                </motion.div>
              )}

              {/* Tips */}
              {step.tips && step.tips.length > 0 && (
                <motion.ul
                  className="space-y-2"
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                >
                  {step.tips.map((tip, i) => (
                    <motion.li
                      key={i}
                      variants={staggerItem}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                      {tip}
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center gap-3"
        >
          {current > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => paginate(-1)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Atrás
            </Button>
          ) : (
            <div />
          )}

          <Button onClick={() => paginate(1)} className="ml-auto">
            {current === total - 1 ? "Comenzar" : "Siguiente"}
            {current < total - 1 && <ChevronRight className="ml-1 h-4 w-4" />}
          </Button>
        </motion.div>

        {/* Dots */}
        <div className="flex justify-center gap-1.5">
          {steps.map((_, i) => (
            <motion.button
              key={i}
              onClick={() => jumpTo(i)}
              animate={{
                width: i === current ? 16 : 8,
                backgroundColor:
                  i === current
                    ? "hsl(var(--primary))"
                    : i < current
                    ? "hsl(var(--primary) / 0.5)"
                    : "hsl(var(--border))",
              }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="h-2 rounded-full"
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Tutorial;
