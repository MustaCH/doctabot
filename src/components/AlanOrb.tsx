import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import "./alan-orb.css";

/** Tamaños del orb. El blur de cada uno vive en alan-orb.css — no escalar con transform. */
export type AlanOrbSize = "hero" | "lg" | "md" | "sm";

/** Los seis estados de Alan (F2 · Corriente). El mapeo a banderas del chat es del consumidor. */
export type AlanOrbState = "idle" | "listening" | "thinking" | "executing" | "attention" | "error";

interface AlanOrbProps {
  /** hero=112 (estado vacío) · lg=76 (grabando) · md=36 (header) · sm=28 (burbuja) */
  size?: AlanOrbSize;
  state?: AlanOrbState;
  className?: string;
  /** Sin label el orb es decorativo (aria-hidden). */
  "aria-label"?: string;
}

/**
 * El avatar vivo de Alan: círculo con corrientes de luz girando bajo vidrio
 * esmerilado. Reemplaza a src/assets/alan-avatar.png.
 *
 * Animar blur + backdrop-filter sin parar es caro en Android de gama media,
 * así que las animaciones se pausan con document.hidden y, en los tamaños
 * grandes, cuando el orb sale del viewport.
 */
export function AlanOrb({ size = "md", state = "idle", className, "aria-label": ariaLabel }: AlanOrbProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const observeViewport = size === "hero" || size === "lg";
  useEffect(() => {
    if (!observeViewport) {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, [observeViewport]);

  return (
    <div
      ref={ref}
      className={cn("alan-orb", className)}
      data-size={size}
      data-state={state}
      data-paused={hidden || !inView || undefined}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <div className="halo" />
      <div className="orb-scale">
        <div className="vessel">
          <div className="fa" />
          <div className="fb" />
          <div className="fc" />
          {state === "thinking" && <div className="sweep" />}
        </div>
        <div className="shell" />
        {state === "listening" && <div className="ripple" />}
        {state === "executing" && (
          <>
            <div className="pulse" />
            <div className="pulse2" />
          </>
        )}
        {size !== "sm" && <div className="spec" />}
      </div>
    </div>
  );
}
