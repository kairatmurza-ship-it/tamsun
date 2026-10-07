import { useLayoutEffect, useRef, useState } from "react";
import { useStoreVersion } from "../lib/StoreProvider.jsx";
import {
  addToCart,
  buildProductWhatsAppLink,
  formatPrice,
  getCatalogState,
  getCurrency,
  getProductPriceKzt,
  isInCart,
  loadProducts,
  mediaUrl,
  retryCatalog,
  setCurrency,
} from "../lib/store.js";

function PieceDescription({ text }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [needsToggle, setNeedsToggle] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    let alive = true;
    const measure = () => {
      if (!alive || node.classList.contains("is-open")) return;
      setNeedsToggle(node.scrollHeight > node.clientHeight + 2);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    document.fonts?.ready?.then(measure);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [text, open]);

  const toggle = () => {
    if (!needsToggle) return;
    setOpen((value) => !value);
  };

  return (
    <>
      <p ref={ref} className={open ? "piece-desc is-open" : "piece-desc"} data-desc="" onClick={toggle}>
        {text}
      </p>
      <button type="button" className="piece-more" data-more="" hidden={!needsToggle} onClick={toggle}>
        {open ? "Свернуть" : "Читать полностью"}
      </button>
    </>
  );
}

export default function ShopGrid() {
  useStoreVersion();
  const [retrying, setRetrying] = useState(false);
  const catalog = getCatalogState();
  const currency = getCurrency();
  const products = loadProducts().filter((item) => item.visible !== false);

  async function onRetry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await retryCatalog();
    } catch (error) {
      /* catalog flag already marks the failure */
    } finally {
      setRetrying(false);
    }
  }

  if (catalog.isError) {
    return (
      <div className="shop-empty catalog-error">
        <p>Не удалось загрузить каталог. Пожалуйста, обновите страницу</p>
        <button type="button" className="btn" onClick={onRetry} disabled={retrying}>
          {retrying ? "Загружаю…" : "Повторить"}
        </button>
      </div>
    );
  }

  if (!catalog.loaded) {
    return <p className="shop-empty">Загружаю каталог…</p>;
  }

  return (
    <>
      {catalog.stale ? (
        <div className="shop-empty catalog-error">
          <p>Каталог мог устареть. Пожалуйста, обновите страницу</p>
          <button type="button" className="btn" onClick={onRetry} disabled={retrying}>
            {retrying ? "Загружаю…" : "Повторить"}
          </button>
        </div>
      ) : null}
      <div className="shop-tools" id="shop-tools">
        <div className="currency-toggle" role="group" aria-label="Валюта">
          <button
            type="button"
            className={currency === "kzt" ? "currency-btn is-active" : "currency-btn"}
            onClick={() => setCurrency("kzt")}
          >
            ₸ Тенге
          </button>
          <button
            type="button"
            className={currency === "usd" ? "currency-btn is-active" : "currency-btn"}
            onClick={() => setCurrency("usd")}
          >
            $ Dollar
          </button>
        </div>
      </div>
      <div className="piece-row catalog-row" id="shop-grid">
        {products.length ? (
          products.map((item) => {
            const meta = [item.size, item.material, item.origin].filter(Boolean);
            const inCart = isInCart(item.id);
            return (
              <article className="piece catalog-piece" key={item.id}>
                <div className="piece-photo">
                  <img src={mediaUrl(item.image)} alt={item.name} />
                </div>
                <div className="piece-body">
                  <div className="piece-top">
                    <p className="piece-label">{item.label || "Tamsun"}</p>
                    <h3>{item.name}</h3>
                    <PieceDescription text={item.description || ""} />
                  </div>
                  <div className="piece-footer">
                    <p className="piece-price">{formatPrice(getProductPriceKzt(item), currency)}</p>
                    <ul className="piece-meta">
                      {meta.length ? meta.map((line) => <li key={line}>{line}</li>) : <li>&nbsp;</li>}
                    </ul>
                    <div className="piece-actions">
                      <button
                        type="button"
                        className={inCart ? "piece-cart is-in-cart" : "piece-cart"}
                        aria-pressed={inCart}
                        onClick={() => {
                          if (!inCart) addToCart(item.id, 1);
                        }}
                      >
                        {inCart ? "Добавлено" : "Корзина"}
                      </button>
                      <a
                        className="piece-buy"
                        data-order-source="product"
                        data-product-id={item.id}
                        href={buildProductWhatsAppLink(item)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Заказать
                      </a>
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <p className="shop-empty">Скоро здесь появятся изделия. Загляните позже или напишите нам в WhatsApp.</p>
        )}
      </div>
    </>
  );
}
