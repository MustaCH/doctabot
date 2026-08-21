import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { AlanOrb } from "@/components/AlanOrb";

const Login = () => {
  const { signInWithGoogle } = useAuth();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6" style={{ backgroundImage: "radial-gradient(ellipse 130% 55% at 50% -8%, rgba(76,141,255,0.18) 0%, rgba(76,141,255,0) 62%), radial-gradient(ellipse 90% 40% at 15% 105%, rgba(255,90,77,0.10) 0%, rgba(255,90,77,0) 60%)" }}>
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Logo / Branding */}
        <div className="space-y-3">
          <div className="mx-auto flex items-center justify-center pb-4">
            <AlanOrb size="hero" aria-label="Alan" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Alan</h1>
          <p className="text-sm text-muted-foreground">
            Tu asistente de IA para buscar propiedades, ordenar clientes y llegar antes.
          </p>
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/5 px-3.5 py-1.5 text-xs text-muted-foreground">
              Powered by
              <span className="font-semibold text-[hsl(var(--accent-soft-foreground))]">RE/MAX Docta</span>
            </span>
          </div>
        </div>

        {/* Google Sign In */}
        <Button
          onClick={signInWithGoogle}
          variant="outline"
          className="h-12 w-full gap-3 rounded-[14px] border-transparent bg-white text-base font-semibold text-[#131519] shadow-[0_12px_28px_-14px_rgba(255,255,255,0.4)] transition-all hover:bg-white/90"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Iniciar sesión con Google
        </Button>

        <p className="text-[11px] text-muted-foreground/60">
          Al continuar, aceptás los términos y condiciones de uso.
        </p>
      </div>
    </div>
  );
};

export default Login;
