import { useEffect } from "react";

/**
 * Expone el alto del teclado virtual como CSS var `--keyboard-inset` en :root,
 * usando la VisualViewport API.
 *
 * Se calcula como innerHeight - visualViewport.height - offsetTop: ambos son
 * medidas del mismo origen, así que la resta da el alto que el teclado le come
 * al viewport (0 si está cerrado). NO atamos la altura del layout a
 * visualViewport.height porque en iOS standalone puede excluir el safe-area
 * inferior y dejar una franja sin pintar; en cambio el layout sigue usando
 * 100dvh (que cubre toda la pantalla) y le RESTA --keyboard-inset por calc().
 *
 * Sin VisualViewport (navegadores viejos) la var queda sin setear y el CSS cae
 * al fallback (0px). Montar una sola vez, a nivel app.
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    const update = () => {
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--keyboard-inset", `${Math.round(keyboard)}px`);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
}
