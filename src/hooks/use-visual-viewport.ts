import { useEffect } from "react";

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

/**
 * Expone el alto del teclado virtual como CSS var `--keyboard-inset` en :root,
 * usando la VisualViewport API. El layout usa `calc(100dvh - var(--keyboard-inset))`.
 *
 * Clave anti "franja gris": el teclado SOLO puede estar visible si hay un
 * elemento editable enfocado. Si no lo hay, forzamos el inset a 0 — así nunca
 * queda "pegado" un valor residual cuando iOS standalone no dispara un resize
 * limpio al cerrar el teclado (lo que dejaba el safe-area inferior sin pintar y
 * asomaba el fondo del body como una franja gris).
 *
 * Sin VisualViewport (navegadores viejos) la var queda en su fallback (0px).
 * Montar una sola vez, a nivel app.
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    const update = () => {
      const keyboard = isEditable(document.activeElement)
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0;
      root.style.setProperty("--keyboard-inset", `${Math.round(keyboard)}px`);
    };

    const onFocusOut = () => {
      // El blur cierra el teclado; tras el settle recalculamos y limpiamos
      // cualquier scroll residual del viewport (bug de iOS standalone).
      setTimeout(() => {
        update();
        if (!isEditable(document.activeElement)) window.scrollTo(0, 0);
      }, 50);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", onFocusOut);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", onFocusOut);
    };
  }, []);
}
