import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center animate-in fade-in duration-300">
          <div className="bg-destructive/10 text-destructive p-4 rounded-full mb-4 border border-destructive/20">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold tracking-tight mb-2 text-foreground">Something went wrong</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6">
            An unexpected error occurred in this component.
          </p>
          <div className="bg-muted/50 p-4 rounded-lg border border-border text-left w-full max-w-2xl overflow-auto text-xs font-mono text-muted-foreground whitespace-pre-wrap">
            {process.env.NODE_ENV === 'development'
              ? (this.state.error?.stack || this.state.error?.message || 'Unknown error')
              : (this.state.error?.message || 'An unexpected error occurred')}
          </div>
          <button 
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-6 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
