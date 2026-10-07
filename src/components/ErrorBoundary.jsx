import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    const name = error && error.name ? error.name : "error";
    console.error("ui_render_failed", name);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="catalog-error-page">
          <p>Что-то пошло не так. Попробуйте перезагрузить страницу</p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Перезагрузить
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
