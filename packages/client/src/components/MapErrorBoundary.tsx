import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches MapLibre WebGL errors so the rest of the page still renders.
 * Without this, a WebGL failure kills the entire React tree.
 */
export default class MapErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn('Map failed to load:', error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '100%', height: '100%', background: '#f5f0e8', color: '#666',
          }}>
            Map unavailable (WebGL required)
          </div>
        )
      );
    }
    return this.props.children;
  }
}
