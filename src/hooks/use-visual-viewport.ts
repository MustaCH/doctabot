import { useEffect } from "react";

/**
 * Sincroniza dos CSS custom properties en :root con la VisualViewport API:
 *
 *  --app-height     → altura del área visible (excluye el teclado). Usar en vez de
 *                     100dvh para que el layout se achique en tiempo real cuando
 *                     se abre el teclado en iOS (donde dvh NO se actualiza).
 *  --keyboard-inset → cuántos px del bottom tapa el teclado. Permite colapsar el
 *                     safe-area-inset-bottom cuando el teclado ya cubre esa zona
 *                     (evita el "padding fantasma" debajo del input).
 *
 * Sin VisualViewport (navegadores viejos) las vars quedan sin setear y el CSS cae
 * al fallback (100dvh / inset normal). Montar una sola vez, a nivel app.
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
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
