// ErrorBoundary global (ticket 86aj18r6x). Captura errores de render de React
// (que window.onerror NO ve), los reporta vía reportFrontendError y muestra un
// fallback en vez de una pantalla en blanco.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportFrontendError } from "@/lib/error-reporting";

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
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-lg font-semibold">Algo salió mal</h1>
          <p className="text-sm text-muted-foreground">
            Tuvimos un problema cargando esta pantalla. Ya quedó registrado.
          </p>
          <button
            onClick={this.handleReload}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
