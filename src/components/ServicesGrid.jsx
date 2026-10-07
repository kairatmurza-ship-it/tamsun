import { useStoreVersion } from "../lib/StoreProvider.jsx";
import { getCatalogState, loadServices, whatsappLink } from "../lib/store.js";

const SERVICE_TEXT = "Здравствуйте! Интересует услуга по разработке сувениров / кубков / индивидуальных подарков.";

export default function ServicesGrid() {
  useStoreVersion();
  const catalog = getCatalogState();
  const services = loadServices().filter((item) => item.visible !== false);
  if (!catalog.loaded || catalog.isError) return null;

  return (
    <section className="services" id="services">
      <div className="services-inner">
        <div className="services-intro">
          <h2>Услуги под заказ</h2>
        </div>
        <div className="services-grid" id="services-grid">
          {services.length ? (
            services.map((item) => (
              <article className="service-card" key={item.id}>
                <h3>{item.title}</h3>
                <p>{item.description || ""}</p>
              </article>
            ))
          ) : (
            <p className="shop-empty">Услуги скоро появятся.</p>
          )}
        </div>
        <a
          className="btn services-btn"
          data-order-source="service"
          href={whatsappLink(SERVICE_TEXT)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Обсудить услугу
        </a>
      </div>
    </section>
  );
}
