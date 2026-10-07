import { useEffect } from "react";
import { Link } from "react-router-dom";
import ShopGrid from "../components/ShopGrid.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import BrandLogo from "../components/BrandLogo.jsx";
import { whatsappLink } from "../lib/store.js";

export default function ProductsPage() {
  useEffect(() => {
    document.title = "Все товары — Tamsun Group";
  }, []);

  return (
    <>
      <header className="page-top">
        <Link className="page-brand" to="/">
          <BrandLogo />
        </Link>
        <nav className="page-nav">
          <Link to="/">На главную</Link>
          <a data-order-source="whatsapp" href={whatsappLink("Здравствуйте! Хочу оформить заказ в Tamsun.")} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
        </nav>
      </header>
      <main>
        <section className="products-page" id="shop">
          <div className="pieces-shell">
            <div className="pieces-intro products-intro">
              <h2>Все товары</h2>
              <p>Премиальные сувениры Tamsun — выберите изделие и оформите заказ в WhatsApp.</p>
            </div>
            <ShopGrid />
          </div>
        </section>
      </main>
      <SiteFooter showProducts={false} />
    </>
  );
}
