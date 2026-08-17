import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { tr } from "../i18n";

type RuntimeErrorBoundaryProps = {
  children: ReactNode;
};

type RuntimeErrorBoundaryState = {
  fatalError: string | null;
  runtimeError: string | null;
};

export class RuntimeErrorBoundary extends Component<RuntimeErrorBoundaryProps, RuntimeErrorBoundaryState> {
  state: RuntimeErrorBoundaryState = { fatalError: null, runtimeError: null };

  componentDidMount(): void {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
    window.addEventListener("routemarket:runtime-error", this.handleMainProcessError as EventListener);
  }

  componentWillUnmount(): void {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
    window.removeEventListener("routemarket:runtime-error", this.handleMainProcessError as EventListener);
  }

  static getDerivedStateFromError(error: unknown): Partial<RuntimeErrorBoundaryState> {
    return { fatalError: errorMessage(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("RouteMarket Work recovered from a renderer error.", error, info.componentStack);
  }

  private readonly handleWindowError = (event: ErrorEvent): void => {
    console.error("RouteMarket Work captured a window error.", event.error ?? event.message);
    event.preventDefault();
    this.setState({ runtimeError: errorMessage(event.error ?? event.message) });
  };

  private readonly handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    console.error("RouteMarket Work captured an unhandled promise rejection.", event.reason);
    event.preventDefault();
    this.setState({ runtimeError: errorMessage(event.reason) });
  };

  private readonly handleMainProcessError = (event: CustomEvent<string>): void => {
    this.setState({ runtimeError: errorMessage(event.detail) });
  };

  render(): ReactNode {
    if (this.state.fatalError) {
      return (
        <main className="rm-runtime-error-fallback" role="alert">
          <AlertTriangle size={22}/>
          <h1>{tr("runtime.error.fatalTitle")}</h1>
          <p>{tr("runtime.error.fatalDescription")}</p>
          <button type="button" onClick={() => this.setState({ fatalError: null })}>
            <RotateCcw size={15}/>{tr("runtime.error.retry")}
          </button>
        </main>
      );
    }

    return (
      <>
        {this.props.children}
        {this.state.runtimeError && (
          <aside className="rm-runtime-error-notice" role="status">
            <AlertTriangle size={16}/>
            <div><strong>{tr("runtime.error.recoveredTitle")}</strong><span>{this.state.runtimeError}</span></div>
            <button type="button" aria-label={tr("runtime.error.dismiss")} onClick={() => this.setState({ runtimeError: null })}><X size={15}/></button>
          </aside>
        )}
      </>
    );
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return tr("runtime.error.unknown");
}
