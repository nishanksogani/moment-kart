import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('Application render failed', error); }
  render() {
    if (this.state.failed) return <main className="page"><div className="api-failure" role="alert"><h1>Something went wrong</h1><p>Your cart is saved in this browser. Please reload the page and try again.</p><button type="button" className="btn" onClick={() => window.location.reload()}>Reload page</button></div></main>;
    return this.props.children;
  }
}
