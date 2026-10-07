import { useEffect, useState } from "react";
import { useStoreVersion } from "../lib/StoreProvider.jsx";
import {
  buildCartWhatsAppLink,
  clearCart,
  dropHiddenCartItems,
  formatPrice,
  getCartCount,
  getCartLines,
  getCartTotalKzt,
  getCatalogState,
  getCurrency,
  getHiddenCartCount,
  getProductPriceKzt,
  loadCart,
  mediaUrl,
  removeFromCart,
  setCartQty,
} from "../lib/store.js";

export default function CartDrawer() {
  useStoreVersion();
  const [open, setOpen] = useState(false);
  const currency = getCurrency();
  const lines = getCartLines();
  const count = getCartCount();
  const hiddenCount = getHiddenCartCount();
  const catalog = getCatalogState();
  const waitingForCatalog = !catalog.loaded && loadCart().some((item) => Number(item.qty) > 0);

  useEffect(() => {
    document.body.classList.toggle("cart-open", open);
    return () => document.body.classList.remove("cart-open");
  }, [open]);

  return (
    <div id="cart-root">
      <button type="button" className="cart-fab" id="cart-open" aria-label="Открыть корзину" onClick={() => setOpen(true)}>
        <span>Корзина</span>
        <span className="cart-count" id="cart-count" hidden={count === 0}>
          {count}
        </span>
      </button>
      <div className="cart-overlay" id="cart-overlay" hidden={!open} onClick={() => setOpen(false)} />
      <aside className="cart-drawer" id="cart-drawer" hidden={!open} aria-label="Корзина">
        <div className="cart-head">
          <h2>Корзина</h2>
          <button type="button" className="cart-close" id="cart-close" aria-label="Закрыть" onClick={() => setOpen(false)}>
            Закрыть
          </button>
        </div>
        <div className="cart-body" id="cart-body">
          {lines.length ? (
            lines.map((item) => (
              <article className="cart-line" key={item.id}>
                <div className="cart-line-media">
                  <img src={mediaUrl(item.image)} alt={item.name} />
                </div>
                <div className="cart-line-info">
                  <h3>{item.name}</h3>
                  <p>{formatPrice(getProductPriceKzt(item), currency)}</p>
                  <div className="cart-line-qty">
                    <button
                      type="button"
                      aria-label="Меньше"
                      onClick={() => {
                        const line = loadCart().find((entry) => entry.id === item.id);
                        setCartQty(item.id, (line ? Number(line.qty) : 1) - 1);
                      }}
                    >
                      −
                    </button>
                    <span>{item.qty}</span>
                    <button
                      type="button"
                      aria-label="Больше"
                      onClick={() => {
                        const line = loadCart().find((entry) => entry.id === item.id);
                        setCartQty(item.id, (line ? Number(line.qty) : 0) + 1);
                      }}
                    >
                      +
                    </button>
                  </div>
                  <p className="cart-line-sum">{formatPrice(item.lineTotalKzt, currency)}</p>
                  <button type="button" className="cart-line-remove" onClick={() => removeFromCart(item.id)}>
                    Удалить
                  </button>
                </div>
              </article>
            ))
          ) : waitingForCatalog ? (
            <p className="cart-empty">Каталог ещё не загружен. Товары в корзине появятся, когда он откроется.</p>
          ) : (
            <p className="cart-empty">Корзина пуста. Добавьте изделия из магазина.</p>
          )}
          {hiddenCount > 0 ? (
            <p className="cart-empty">
              {hiddenCount === 1 ? "Один товар больше не продаётся и не входит в сумму." : "Часть товаров больше не продаётся и не входит в сумму."}{" "}
              <button type="button" className="cart-line-remove" onClick={dropHiddenCartItems}>
                Убрать
              </button>
            </p>
          ) : null}
        </div>
        <div className="cart-foot">
          <p className="cart-total">
            Итого: <strong id="cart-total">{formatPrice(getCartTotalKzt(), currency)}</strong>
          </p>
          <a
            className={lines.length ? "cart-checkout" : "cart-checkout is-disabled"}
            id="cart-checkout"
            href={buildCartWhatsAppLink()}
            target="_blank"
            rel="noopener noreferrer"
          >
            Заказать
          </a>
          <button
            type="button"
            className="cart-clear"
            id="cart-clear"
            onClick={() => {
              if (!getCartCount()) return;
              if (confirm("Очистить корзину?")) clearCart();
            }}
          >
            Очистить корзину
          </button>
        </div>
      </aside>
    </div>
  );
}
