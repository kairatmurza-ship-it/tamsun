import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  apiFetch,
  buildCartWhatsAppLink,
  buildProductWhatsAppLink,
  findPendingOrder,
  getCartLines,
  getCartTotalKzt,
  getCurrency,
  getProductPriceKzt,
  loadProducts,
  forgetPendingOrder,
  pendingSignature,
  getCatalogState,
  refreshCatalog,
  rememberPendingOrder,
  settleSavedOrder,
  whatsappLink,
} from "../lib/store.js";

const NAME_KEY = "tamsun_request_name";
const PHONE_KEY = "tamsun_request_phone";

function whatsappHost(href) {
  try {
    return new URL(href, window.location.href).hostname;
  } catch (error) {
    return "";
  }
}

function messageFromLink(href) {
  try {
    return new URL(href, window.location.href).searchParams.get("text") || "";
  } catch (error) {
    return "";
  }
}

function snapshot(product, qty) {
  const count = Math.max(1, Number(qty) || 1);
  const price = getProductPriceKzt(product);
  return {
    id: product.id,
    name: product.name,
    qty: count,
    priceKzt: price,
    lineTotalKzt: price * count,
  };
}

function findProduct(id) {
  if (!id) return null;
  return loadProducts().find((item) => item.id === id) || null;
}

function orderFromLink(link) {
  const sourceAttr = link.getAttribute("data-order-source");
  let source = sourceAttr || "whatsapp";
  if (link.id === "cart-checkout") source = "cart";
  else if (link.classList.contains("piece-buy")) source = "product";
  else if (!sourceAttr && link.closest(".chat-widget")) source = "chat";

  const items = [];
  let totalKzt = 0;

  if (source === "chat" && !findProduct(link.getAttribute("data-product-id"))) source = "whatsapp";

  if (source === "cart") {
    getCartLines().forEach((item) => {
      const price = getProductPriceKzt(item);
      items.push({
        id: item.id,
        name: item.name,
        qty: item.qty,
        priceKzt: price,
        lineTotalKzt: item.lineTotalKzt,
      });
    });
    totalKzt = getCartTotalKzt();
  } else {
    const product = findProduct(link.getAttribute("data-product-id"));
    if (product) {
      items.push(snapshot(product, 1));
      totalKzt = items[0].lineTotalKzt;
    }
  }

  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const page = path.endsWith("/products") ? "products.html" : path.endsWith("/admin") ? "admin.html" : "index.html";
  return {
    source,
    page,
    currency: getCurrency(),
    message: messageFromLink(link.href).slice(0, 2000),
    totalKzt,
    items,
  };
}

function createRequestId() {
  if (window.crypto && crypto.getRandomValues) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(16).slice(2, 14).padEnd(12, "0").slice(0, 12);
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function orderErrorText(code) {
  if (code === "unavailable") return "Этого изделия уже нет в продаже. Обновите страницу.";
  if (code === "unknown_product") return "Не удалось найти товар. Обновите страницу.";
  if (code === "empty_cart") return "Корзина пуста.";
  if (code === "too_many") return "В заявке слишком много позиций. Оставьте не больше 30.";
  if (code === "rate") return "Слишком много заявок подряд. Подождите минуту и отправьте ещё раз.";
  return "Заявка не сохранилась. Попробуйте ещё раз.";
}

function refreshOrderLink(link) {
  const preview = orderFromLink(link);
  if (preview.source === "cart") {
    const href = buildCartWhatsAppLink();
    if (href && href.indexOf("text=") !== -1) link.href = href;
  } else if (preview.source === "product" || preview.source === "chat") {
    const product = findProduct(link.getAttribute("data-product-id"));
    if (product) link.href = buildProductWhatsAppLink(product);
  }
}

function whatsappHref(href, name, phone) {
  const url = new URL(href, window.location.href);
  const text = url.searchParams.get("text") || "";
  const contact = `Имя: ${name}\nТелефон: ${phone}`;
  const next = [text.trim(), contact].filter(Boolean).join("\n\n").slice(0, 1500);
  url.searchParams.set("text", next);
  return { href: url.toString(), message: next };
}

export default function RequestGate() {
  const location = useLocation();
  const pendingLink = useRef(null);
  const pendingRequestId = useRef("");
  const submitting = useRef(false);
  const savedLink = useRef("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [successHref, setSuccessHref] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);
  const phoneRef = useRef(null);

  useEffect(() => {
    document.body.classList.toggle("request-open", open);
    return () => document.body.classList.remove("request-open");
  }, [open]);

  function closeRequest() {
    if (submitting.current) return;
    setOpen(false);
    pendingLink.current = null;
    pendingRequestId.current = "";
    savedLink.current = "";
    setError("");
    setSuccessHref("");
    setBusy(false);
  }

  useEffect(() => {
    function onClick(event) {
      const link = event.target.closest("a[href]");
      if (!link) return;
      if (event.type === "auxclick" && event.button !== 1) return;
      if (event.type === "click" && event.button !== 0) return;
      const host = whatsappHost(link.href);
      if (host !== "wa.me" && host !== "api.whatsapp.com") return;
      if (link.closest(".request-error")) return;
      const order = orderFromLink(link);
      event.preventDefault();
      event.stopPropagation();
      if (order.source === "cart" && !order.items.length) return;
      pendingLink.current = link;
      try {
        setName(sessionStorage.getItem(NAME_KEY) || "");
        setPhone(sessionStorage.getItem(PHONE_KEY) || "");
      } catch (error) {}
      setError("");
      setSuccessHref("");
      pendingRequestId.current = "";
      savedLink.current = "";
      setBusy(false);
      setOpen(true);
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const focusTarget = name.trim() ? phoneRef.current : nameRef.current;
    focusTarget?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") closeRequest();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function submitRequest(event) {
    event.preventDefault();
    const link = pendingLink.current;
    if (!link || submitting.current || savedLink.current) return;
    const nextName = name.trim();
    const nextPhone = phone.trim();
    if (nextName.length < 2) {
      setError("Напишите имя.");
      nameRef.current?.focus();
      return;
    }
    const digits = phoneDigits(nextPhone);
    if (digits.length < 10 || digits.length > 15) {
      setError("Проверьте номер телефона.");
      phoneRef.current?.focus();
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError("");
    setSuccessHref("");
    const popup = window.open("about:blank", "_blank");
    let order = null;

    try {
      try {
        await refreshCatalog();
      } catch (error) {
        if (!getCatalogState().loaded) {
          if (popup && !popup.closed) popup.close();
          setError("Не удалось загрузить каталог. Пожалуйста, обновите страницу");
          return;
        }
      }
      if (!getCatalogState().loaded || getCatalogState().isError) {
        if (popup && !popup.closed) popup.close();
        setError("Не удалось загрузить каталог. Пожалуйста, обновите страницу");
        return;
      }
      refreshOrderLink(link);
      order = orderFromLink(link);
      if (order.source === "cart" && !order.items.length) {
        if (popup && !popup.closed) popup.close();
        setError(orderErrorText("empty_cart"));
        return;
      }
      order.signature = pendingSignature(order);
      const matched = findPendingOrder(order);
      pendingRequestId.current = matched ? matched.requestId : createRequestId();
      const draft = whatsappHref(link.href, nextName, nextPhone);
      order.requestId = pendingRequestId.current;
      order.customerName = nextName.slice(0, 80);
      order.customerPhone = nextPhone.slice(0, 32);
      order.message = draft.message;
      try {
        sessionStorage.setItem(NAME_KEY, order.customerName);
        sessionStorage.setItem(PHONE_KEY, order.customerPhone);
      } catch (error) {}

      const response = await apiFetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(order),
        keepalive: true,
      });
      let data = {};
      try {
        data = await response.json();
      } catch (error) {}
      if (!response.ok) {
        if (popup && !popup.closed) popup.close();
        setError(data.message || orderErrorText(data.error));
        return;
      }
      if (data.status === "cancelled") {
        if (popup && !popup.closed) popup.close();
        forgetPendingOrder(order.requestId);
        setError("Эта заявка уже отменена. Отправьте её ещё раз, если заказ всё ещё нужен.");
        return;
      }
      const message = await settleSavedOrder(order, data, true);
      const href = whatsappLink(message);
      let opened = false;
      try {
        if (popup && !popup.closed) {
          popup.location.href = href;
          opened = true;
        }
      } catch (error) {}
      if (opened) {
        setOpen(false);
        pendingLink.current = null;
        pendingRequestId.current = "";
        return;
      }
      savedLink.current = href;
      setSuccessHref(href);
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      if (order && order.requestId) rememberPendingOrder(order);
      setError(
        "Нет связи с сервером. Эта заявка останется в очереди и уйдёт сама, когда сервер ответит. Повторное нажатие отправляет её же, а не новую."
      );
    } finally {
      submitting.current = false;
      if (!savedLink.current) setBusy(false);
    }
  }

  return (
    <div id="request-modal" className="request-modal" hidden={!open}>
      <div className="request-backdrop" onClick={closeRequest} />
      <form className="request-dialog" id="request-form" role="dialog" aria-modal="true" aria-labelledby="request-title" onSubmit={submitRequest}>
        <div className="request-head">
          <h2 id="request-title">Заявка</h2>
          <button type="button" className="request-close" aria-label="Закрыть" onClick={closeRequest}>
            ×
          </button>
        </div>
        <p className="request-lead">Напишите имя и телефон. Заявка сохранится, и откроется WhatsApp с уже готовым сообщением.</p>
        <label>
          Имя
          <input
            ref={nameRef}
            type="text"
            id="request-name"
            name="name"
            autoComplete="name"
            maxLength={80}
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
              setSuccessHref("");
            }}
          />
        </label>
        <label>
          Номер телефона
          <input
            ref={phoneRef}
            type="tel"
            id="request-phone"
            name="phone"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+7 701 000 00 00"
            maxLength={32}
            required
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setError("");
              setSuccessHref("");
            }}
          />
        </label>
        <p className={successHref ? "request-error is-ok" : "request-error"} hidden={!error && !successHref}>
          {successHref ? (
            <>
              Заявка сохранена. Браузер заблокировал окно WhatsApp.{" "}
              <a href={successHref} target="_blank" rel="noopener noreferrer">
                Открыть WhatsApp
              </a>
            </>
          ) : (
            error
          )}
        </p>
        <div className="request-actions">
          <button type="submit" className="request-submit" disabled={busy}>
            Отправить заявку
          </button>
          <button type="button" onClick={closeRequest}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  );
}
