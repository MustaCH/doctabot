import { useEffect } from "react";

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

/**
 * Sincroniza dos CSS vars en :root para el shell de la app:
 *
 *  --app-height     → alto total de la pantalla en px (window.innerHeight).
 *                     Reemplaza a 100dvh, que en iOS standalone queda "stuck" en
 *                     un valor incorrecto tras abrir/cerrar el teclado y deja una
 *                     franja gris abajo hasta que un reflow (cambio de ruta) lo
 *                     recalcula. El valor en px no sufre ese bug.
 *  --keyboard-inset → px que el teclado le come al viewport (0 si está cerrado).
 *
 * El layout usa `calc(var(--app-height) - var(--keyboard-inset))`.
 *
 * El teclado SOLO puede estar visible si hay un elemento editable enfocado: si no
 * lo hay, recapturamos el alto real y forzamos el inset a 0 (no dependemos de que
 * iOS dispare un resize limpio al cerrar). Mientras el teclado está abierto NO
 * tocamos --app-height (guardamos el último alto "sin teclado" como base estable).
 *
 * Montar una sola vez, a nivel app.
 */
export function useVisualViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let base = window.innerHeight; // alto full-screen estable (sin teclado)

    const update = () => {
      if (!isEditable(document.activeElement)) {
        base = window.innerHeight;
        root.style.setProperty("--app-height", `${base}px`);
        root.style.setProperty("--keyboard-inset", "0px");
        return;
      }
      if (vv) {
        const kb = Math.max(0, base - vv.height - vv.offsetTop);
        root.style.setProperty("--keyboard-inset", `${Math.round(kb)}px`);
      }
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
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", onFocusOut);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", onFocusOut);
    };
  }, []);
}
