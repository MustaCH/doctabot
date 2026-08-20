import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlanOrb } from "@/components/AlanOrb";
import {
  Search,
  Star,
  Mic,
  FileText,
  MessageSquare,
  Users,
  CalendarCheck,
  Link2,
  BellRing,
  Mail,
  MessageCircle,
  Lightbulb,
  Rocket,
  ChevronRight,
  ChevronLeft,
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
    icon: <AlanOrb size="lg" aria-label="Alan" />,
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
    icon: (
      <div className="flex gap-3">
        <Link2 className="h-10 w-10 text-primary" />
        <BellRing className="h-10 w-10 text-accent" />
      </div>
    ),
    title: "Alan conecta propiedades con clientes 🔔",
    subtitle: "Vos vinculás, Alan vigila y te avisa",
    description:
      "Vinculá una propiedad con un cliente —o contale a Alan qué busca cada uno— y dejá de revisar el portal a mano. Cuando entra una propiedad que encaja con lo que alguien busca, Alan te abre una conversación nueva con el match 🔔.",
    example: '"Vinculá el depto de Nueva Córdoba con Juan Pérez"',
    tips: [
      "Las conversaciones marcadas con 🔔 son matches que Alan encontró por vos.",
      "Cuanto mejor cargás qué busca cada cliente, más afilados son los avisos.",
    ],
  },
  {
    icon: (
      <div className="flex gap-3">
        <Mail className="h-10 w-10 text-primary" />
        <MessageCircle className="h-10 w-10 text-accent" />
      </div>
    ),
    title: "Alan redacta y manda por vos ✍️",
    subtitle: "El mensaje al cliente, listo y enviado",
    description:
      "Pedile el mensaje y Alan lo escribe por vos. Si es un email, lo manda directo (te pide confirmar antes). Si es un WhatsApp, te deja un botón para abrir el chat con el texto ya cargado y enviarlo desde tu número.",
    example: '"Escribile un WhatsApp a María avisándole que bajó el precio del PH"',
    tips: [
      "Email: Alan lo envía (siempre confirmás antes de que salga).",
      "WhatsApp: Alan prepara el texto y vos tocás “Enviar por WhatsApp”.",
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
    <div className="relative flex min-h-[calc(var(--app-height,100dvh)-var(--keyboard-inset,0px))] flex-col overflow-hidden bg-background px-6 safe-top safe-bottom">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        {/* Paso n de N + Omitir */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-4 flex items-center justify-between"
        >
          <span className="text-xs font-semibold text-muted-foreground">{current + 1} de {total}</span>
          <button
            type="button"
            onClick={finish}
            className="-mr-2 flex h-11 items-center px-2 text-[13px] text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            Omitir
          </button>
        </motion.div>

        {/* Contenido del paso (swipeable) */}
        <div className="relative flex flex-1 flex-col justify-center">
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
              className="flex flex-1 cursor-grab flex-col justify-center gap-6 py-4 touch-pan-y active:cursor-grabbing"
            >
              {/* Ícono: orb en el primer paso; el resto en un tile de vidrio de 66px (los lucide del
                  contenido bajan a 30px adentro del tile sin tocar el array `steps`) */}
              <motion.div
                className="flex w-fit"
                variants={iconVariants}
                initial="hidden"
                animate="visible"
              >
                {current === 0 ? (
                  step.icon
                ) : (
                  <span className="flex h-[66px] min-w-[66px] items-center justify-center rounded-[20px] border border-[rgba(91,147,255,0.30)] bg-[rgba(91,147,255,0.14)] px-[9px] [&_svg]:h-[30px] [&_svg]:w-[30px]">
                    {step.icon}
                  </span>
                )}
              </motion.div>

              {/* Texto */}
              <motion.div
                className="space-y-2"
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
              >
                <motion.h1
                  variants={staggerItem}
                  className="text-[26px] font-bold leading-[1.15] tracking-[-0.03em] text-foreground [text-wrap:pretty]"
                >
                  {step.title}
                </motion.h1>
                <motion.p
                  variants={staggerItem}
                  className="text-[13px] font-medium text-[hsl(var(--primary-soft-foreground))]"
                >
                  {step.subtitle}
                </motion.p>
                <motion.p
                  variants={staggerItem}
                  className="pt-2 text-[15px] leading-[1.6] text-foreground/75 [text-wrap:pretty]"
                >
                  {step.description}
                </motion.p>
              </motion.div>

              {/* Ejemplo: bloque con borde izquierdo azul */}
              {step.example && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, duration: 0.3 }}
                  className="rounded-[16px] border border-white/[0.09] border-l-[3px] border-l-[hsl(var(--primary))] bg-white/5 px-[18px] py-4 text-[15px] italic leading-[1.55] text-foreground/90"
                >
                  {step.example}
                </motion.div>
              )}

              {/* Tips con check SVG */}
              {step.tips && step.tips.length > 0 && (
                <motion.ul
                  className="space-y-3"
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                >
                  {step.tips.map((tip, i) => (
                    <motion.li
                      key={i}
                      variants={staggerItem}
                      className="flex items-start gap-[11px] text-sm leading-[1.5] text-foreground/75"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="hsl(var(--brand))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-[3px] h-[17px] w-[17px] flex-shrink-0" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>
                      {tip}
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Puntos de progreso (área táctil 24×44 por punto: 11 puntos de 44 no entran en 390px) */}
        <div className="mb-3 mt-4 flex justify-center" aria-label="Pasos del recorrido">
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-current={i === current ? "step" : undefined}
              aria-label={`Paso ${i + 1}`}
              onClick={() => jumpTo(i)}
              className="flex h-11 min-w-6 items-center justify-center px-[3px]"
            >
              <motion.span
                animate={{
                  width: i === current ? 22 : 6,
                  backgroundColor: i === current ? "#3B7BFF" : "rgba(255,255,255,0.18)",
                }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className="block h-1.5 rounded-full"
              />
            </button>
          ))}
        </div>

        {/* Atrás / Siguiente — 48px */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex gap-3"
        >
          {current > 0 && (
            <button
              type="button"
              onClick={() => paginate(-1)}
              className="flex h-12 w-[108px] shrink-0 items-center justify-center gap-[7px] rounded-[14px] border border-white/[0.09] bg-white/5 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/10"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" /> Atrás
            </button>
          )}

          <button
            type="button"
            onClick={() => paginate(1)}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] bg-[linear-gradient(150deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-[15px] font-semibold text-white shadow-[0_16px_34px_-16px_rgba(59,123,255,0.95)] transition-opacity hover:opacity-90"
          >
            {current === total - 1 ? "Comenzar" : "Siguiente"}
            {current < total - 1 && <ChevronRight className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />}
          </button>
        </motion.div>
      </div>
    </div>
  );
};

export default Tutorial;
