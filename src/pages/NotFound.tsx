import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { AlanOrb } from "@/components/AlanOrb";

// 404 (ticket 86ak3z0dz): en español con voseo, fondo del sistema y el orb en reposo.
// Antes era la plantilla de Lovable en inglés ("Oops! Page not found").
const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-7 bg-background px-6 text-center safe-top safe-bottom">
      <AlanOrb size="lg" state="idle" aria-label="Alan" />
      <div className="max-w-sm space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Error 404</p>
        <h1 className="text-[26px] font-bold leading-[1.15] tracking-[-0.03em] text-foreground">Esta página no existe</h1>
        <p className="text-[15px] leading-[1.6] text-muted-foreground">
          Capaz el link venció o quedó mal escrito. Volvé al chat y seguí desde ahí.
        </p>
      </div>
      <Link
        to="/"
        className="flex h-12 w-full max-w-xs items-center justify-center rounded-[14px] bg-[linear-gradient(150deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-[15px] font-semibold text-white shadow-[0_16px_34px_-16px_rgba(59,123,255,0.95)] transition-opacity hover:opacity-90"
      >
        Volver al inicio
      </Link>
    </div>
  );
};

export default NotFound;
