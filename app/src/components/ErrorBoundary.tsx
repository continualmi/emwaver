import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center bg-slate-950 p-8 text-slate-200">
          <div className="max-w-2xl rounded-lg border border-red-900 bg-slate-900 p-6 shadow-xl">
            <h1 className="mb-4 text-2xl font-bold text-red-500">Something went wrong</h1>
            <div className="mb-4 rounded bg-slate-950 p-4 font-mono text-sm text-red-400 overflow-auto max-h-64">
              {this.state.error && this.state.error.toString()}
            </div>
            <div className="rounded bg-slate-950 p-4 font-mono text-xs text-slate-500 overflow-auto max-h-64 whitespace-pre-wrap">
               {this.state.errorInfo?.componentStack}
            </div>
            <button
              className="mt-6 rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
              onClick={() => window.location.reload()}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
