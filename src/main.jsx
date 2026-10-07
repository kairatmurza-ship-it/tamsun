import { BrowserRouter } from "react-router-dom";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import StoreProvider from "./lib/StoreProvider.jsx";
import "../styles.css";
import "../admin.css";

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  console.error("unhandled_rejection", reason && reason.name ? reason.name : "error");
});

createRoot(document.getElementById("root")).render(
  <StoreProvider>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StoreProvider>
);
