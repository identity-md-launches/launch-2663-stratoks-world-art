import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./Router";
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>Stratoks could not open</h1>
        <p>
          Reload to retry. Your shared world is still running on its server.
        </p>
        <button onClick={() => location.reload()}>Reload Stratoks</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <App />
  </Boundary>,
);
