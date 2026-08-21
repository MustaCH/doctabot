// ErrorBoundary global (ticket 86aj18r6x). Captura errores de render de React
// (que window.onerror NO ve), los reporta vía reportFrontendError y muestra un
// fallback en vez de una pantalla en blanco.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportFrontendError } from "@/lib/error-reporting";
import { AlanOrb } from "@/components/AlanOrb";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void reportFrontendError({
      context: "react-error-boundary",
      error,
      metadata: { componentStack: info.componentStack?.slice(0, 2000) },
    });
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      // Rediseño (ticket 86ak3z0dz): orb en estado error + botón Recargar de 48 del sistema.
      return (
        <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 bg-background p-6 text-center">
          <AlanOrb size="lg" state="error" aria-label="Alan con un problema" />
          <div className="max-w-sm space-y-2">
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-foreground">Algo salió mal</h1>
            <p className="text-sm leading-[1.6] text-muted-foreground">
              Tuvimos un problema cargando esta pantalla. Ya quedó registrado.
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleReload}
            className="flex h-12 w-full max-w-xs items-center justify-center rounded-[14px] bg-[linear-gradient(150deg,hsl(var(--primary)),hsl(var(--primary-deep)))] text-[15px] font-semibold text-white shadow-[0_16px_34px_-16px_rgba(59,123,255,0.95)] transition-opacity hover:opacity-90"
          >
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
