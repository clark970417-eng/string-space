import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="empty-state">
        <h1>練習室暫時遇到問題</h1>
        <p>重新整理後再試，本機保存的樂譜仍會保留。</p>
        <button onClick={() => location.reload()}>重新載入</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
