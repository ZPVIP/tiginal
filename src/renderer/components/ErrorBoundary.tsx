import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
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
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-red-500 bg-[#1a1a1a] h-screen w-screen overflow-auto">
          <h1 className="text-2xl font-bold mb-4">Something went wrong.</h1>
          <p className="font-bold">{this.state.error?.toString()}</p>
          <pre className="mt-4 p-4 bg-black/50 rounded overflow-auto text-xs">
            {this.state.errorInfo?.componentStack}
          </pre>
          <button 
             className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
             onClick={() => window.location.reload()}
          >
              Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
