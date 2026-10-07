import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import CartDrawer from "./components/CartDrawer.jsx";
import ChatWidget from "./components/ChatWidget.jsx";
import Lightbox from "./components/Lightbox.jsx";
import RequestGate from "./components/RequestGate.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import HomePage from "./pages/HomePage.jsx";
import ProductsPage from "./pages/ProductsPage.jsx";

function PublicChrome() {
  return (
    <>
      <CartDrawer />
      <ChatWidget />
      <RequestGate />
      <Lightbox />
    </>
  );
}

export default function App() {
  const location = useLocation();
  const path = (location.pathname.length > 1 ? location.pathname.replace(/\/+$/, "") : location.pathname) || "/";
  const admin = path === "/admin";

  useEffect(() => {
    if (location.hash) {
      const node = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (node) {
        node.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [path, location.hash]);

  if (path !== location.pathname) {
    return <Navigate to={path + location.search + location.hash} replace />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="/products.html" element={<Navigate to="/products" replace />} />
        <Route path="/admin.html" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {admin ? null : <PublicChrome />}
    </>
  );
}
