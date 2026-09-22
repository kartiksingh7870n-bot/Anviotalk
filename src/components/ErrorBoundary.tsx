import React, { ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo?: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorMessage: string | null;
  componentStack: string | null;
  showDebug: boolean;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  public props!: Props;
  public state: State = {
    hasError: false,
    error: null,
    errorMessage: null,
    componentStack: null,
    showDebug: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorMessage: error?.message || (error ? String(error) : "Unknown error"),
      componentStack: null,
      showDebug: false
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by boundary:", error, errorInfo);

    (this as any).setState({
      errorMessage: error?.message || (error ? String(error) : "Unknown error"),
      componentStack: errorInfo?.componentStack || null
    });

    if (typeof sessionStorage !== "undefined") {
      try {
        const crashData = {
          message: error?.message || (error ? String(error) : "Unknown error"),
          stack: error?.stack || null,
          componentStack: errorInfo?.componentStack || null,
          timestamp: new Date().toISOString()
        };
        sessionStorage.setItem("anviotalk_last_crash", JSON.stringify(crashData));
      } catch (sessionError) {
        console.warn("Failed to save crash details to sessionStorage:", sessionError);
      }
    }

    if (this.props.onError) {
      try {
        this.props.onError(error, errorInfo);
      } catch (callbackError) {
        console.error("Error in ErrorBoundary onError callback:", callbackError);
      }
    }
  }

  public handleRetry = (): void => {
    (this as any).setState({
      hasError: false,
      error: null,
      errorMessage: null,
      componentStack: null,
      showDebug: false
    });
  };

  public toggleDebugInfo = (e?: React.MouseEvent): void => {
    if (e) {
      e.preventDefault();
    }
    (this as any).setState((prevState: any) => ({ showDebug: !prevState.showDebug }));
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="min-h-screen bg-[#fbf9f9] flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-white border border-[#efeded] rounded-[2.5rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-rose-500 text-2xl font-bold">⚠️</span>
            </div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight mb-2">Network or display issue</h1>
            <p className="text-xs text-[#444748] font-medium mb-6 leading-relaxed">
              Network issue, please check your connection and try again.
            </p>

            <details
              open={this.state.showDebug}
              onToggle={(e) => {
                (this as any).setState({ showDebug: e.currentTarget.open });
              }}
              className="w-full mb-6 text-left"
            >
              <summary
                onClick={this.toggleDebugInfo}
                className="text-xs text-[#444748] hover:text-slate-900 font-medium cursor-pointer text-center select-none outline-none"
              >
                Show debug info
              </summary>
              {this.state.showDebug && (
                <div className="mt-3 p-3 bg-slate-50 border border-[#efeded] rounded-xl text-left text-xs font-mono text-slate-700 overflow-auto max-h-48">
                  <p className="font-semibold text-rose-600 break-words mb-1">
                    {this.state.errorMessage || this.state.error?.message || "Unknown error"}
                  </p>
                  {this.state.componentStack && (
                    <pre className="text-[10px] text-slate-500 whitespace-pre-wrap overflow-x-auto mt-2 font-mono">
                      {this.state.componentStack}
                    </pre>
                  )}
                </div>
              )}
            </details>

            <button
              onClick={this.handleRetry}
              className="w-full h-11 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-[#854c6f] transition-all cursor-pointer"
            >
              Reload Page 🔄
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
