import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import BrandLogo from "../components/BrandLogo.jsx";
import { useStoreVersion } from "../lib/StoreProvider.jsx";
import {
  DEFAULT_PRODUCTS,
  DEFAULT_SERVICES,
  DEFAULT_SETTINGS,
  TAMSUN_SERVICES_KEY,
  TAMSUN_SETTINGS_KEY,
  TAMSUN_STORE_KEY,
  adminHeaders,
  apiFetch,
  asArray,
  convertFromKzt,
  convertToKzt,
  createId,
  flushPendingOrders,
  formatMoney,
  formatPrice,
  getCurrency,
  getProductPriceKzt,
  getServerSettings,
  isAdminLoggedIn,
  loadProducts,
  loadServices,
  mediaUrl,
  normalizeProduct,
  readPendingOrders,
  refreshCatalog,
  rememberPendingOrder,
  saveProducts,
  saveServerSettings,
  saveServices,
  setAdminLoggedIn,
  setAdminToken,
  uploadImageFile,
} from "../lib/store.js";

const ORDER_SOURCES = {
  cart: "Корзина",
  product: "Товар",
  chat: "Чат",
  service: "Услуга",
  whatsapp: "WhatsApp",
};

const ORDER_STATUSES = [
  ["new", "Новый"],
  ["progress", "В работе"],
  ["done", "Готово"],
  ["cancelled", "Отменён"],
];

function orderItems(order) {
  if (Array.isArray(order.items)) return order.items;
  if (order.items) return [order.items];
  return [];
}

function formatOrderWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function orderStatusLabel(status) {
  const found = ORDER_STATUSES.find(([value]) => value === status);
  return found ? found[1] : "Новый";
}

function clientWhatsAppPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (digits.length === 10) digits = "7" + digits;
  return digits.length >= 11 ? digits : "";
}

function clientKey(order) {
  const digits = clientWhatsAppPhone(order.customerPhone) || String(order.customerPhone || "").replace(/\D/g, "");
  if (digits) return "p:" + digits;
  const name = String(order.customerName || "").trim().toLowerCase();
  if (name) return "n:" + name;
  return "";
}

function managerWhatsAppLink(order) {
  const phone = clientWhatsAppPhone(order.customerPhone);
  if (!phone) return "";
  const name = String(order.customerName || "").trim();
  const goods = orderItems(order)
    .map((item) => {
      const qty = Number(item.qty) || 1;
      const title = String(item.name || "").trim();
      if (!title) return "";
      return qty > 1 ? `${title} × ${qty}` : title;
    })
    .filter(Boolean);
  const hello = name ? `Здравствуйте, ${name}!` : "Здравствуйте!";
  const orderLine = goods.length ? `Вы хотели заказать у нас ${goods.join(", ")}.` : "Вы хотели заказать у нас.";
  const text = `${hello} ${orderLine} Подскажите, пожалуйста, когда вам удобно обсудить заказ.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

function requestCountLabel(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} заявка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} заявки`;
  return `${count} заявок`;
}

function buildClients(ordersCache) {
  const map = new Map();
  ordersCache.forEach((order) => {
    const key = clientKey(order);
    if (!key) return;
    if (!map.has(key)) map.set(key, { key, name: "", phone: "", orders: [] });
    const client = map.get(key);
    client.orders.push(order);
    const name = String(order.customerName || "").trim();
    const phone = String(order.customerPhone || "").trim();
    if (name && !client.name) client.name = name;
    if (phone && !client.phone) client.phone = phone;
  });
  return Array.from(map.values())
    .map((client) => {
      const active = client.orders.filter((order) => order.status !== "cancelled");
      const total = active.reduce((sum, order) => sum + (Number(order.totalKzt) || 0), 0);
      return { ...client, total, latest: client.orders[0] };
    })
    .sort((a, b) => String(b.latest.createdAt).localeCompare(String(a.latest.createdAt)));
}

function clientsForView(ordersCache, clientsCache) {
  const fromOrders = buildClients(ordersCache);
  const byKey = new Map(fromOrders.map((client) => [client.key, client]));
  if (!clientsCache.length) return fromOrders;
  const seen = new Set();
  const list = clientsCache.map((saved) => {
    const key = String(saved.key || clientKey(saved));
    seen.add(key);
    const live = byKey.get(key);
    const latest = live ? live.latest : null;
    return {
      key,
      name: String(saved.customerName || (live && live.name) || "").trim(),
      phone: String(saved.customerPhone || (live && live.phone) || "").trim(),
      orders: live ? live.orders : [],
      total: live ? live.total : 0,
      latest,
      note: String(saved.note || ""),
      sortAt: (latest && latest.createdAt) || saved.updatedAt || saved.createdAt || "",
    };
  });
  fromOrders.forEach((live) => {
    if (seen.has(live.key)) return;
    list.push({ ...live, note: "", sortAt: live.latest ? live.latest.createdAt : "" });
  });
  list.sort((a, b) => String(b.sortAt).localeCompare(String(a.sortAt)));
  return list;
}

function clientRequestLabel(client) {
  const active = client.orders.filter((order) => order.status !== "cancelled").length;
  const cancelled = client.orders.length - active;
  if (!active && cancelled) return `Отменённых: ${cancelled}`;
  if (!cancelled) return requestCountLabel(active);
  return `${requestCountLabel(active)} · отменённых: ${cancelled}`;
}

function goodsLabel(order) {
  return orderItems(order)
    .map((item) => {
      const qty = Number(item.qty) || 1;
      const title = String(item.name || "").trim();
      if (!title) return "";
      return qty > 1 ? `${title} × ${qty}` : title;
    })
    .filter(Boolean)
    .join(", ");
}

function createRequestId() {
  if (window.crypto && crypto.getRandomValues) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(16).slice(2, 14).padEnd(12, "0").slice(0, 12);
}

async function adoptLegacyLocalOrders(ordersCache) {
  let legacy = [];
  try {
    legacy = JSON.parse(localStorage.getItem("tamsun_orders_local") || "[]");
  } catch (error) {
    legacy = [];
  }
  if (!Array.isArray(legacy) || !legacy.length) return false;
  const pending = [];
  legacy.forEach((item) => {
    const exists = ordersCache.some(
      (order) => String(order.customerPhone || "") === String(item.customerPhone || "") && String(order.message || "") === String(item.message || "")
    );
    if (exists) return;
    pending.push({ ...item, requestId: item.requestId || createRequestId() });
  });
  localStorage.removeItem("tamsun_orders_local");
  pending.forEach((order) => rememberPendingOrder(order));
  await flushPendingOrders();
  return true;
}

function catalogSignature(list, pick) {
  return list.map(pick).join("|");
}

async function migrateLocalCatalog() {
  if (sessionStorage.getItem("tamsun_migrated_v1")) return;
  try {
    await refreshCatalog();
  } catch (error) {
    return;
  }
  try {
    const localProducts = JSON.parse(localStorage.getItem(TAMSUN_STORE_KEY) || "null");
    if (Array.isArray(localProducts) && localProducts.length) {
      const pick = (item) => [item.id, item.name, item.priceKzt, item.image].join("~");
      const serverSig = catalogSignature(loadProducts(), pick);
      const localSig = catalogSignature(localProducts, pick);
      const defaultSig = catalogSignature(DEFAULT_PRODUCTS, pick);
      if (serverSig === defaultSig && localSig !== defaultSig) {
        const next = [];
        for (const item of localProducts) {
          const copy = normalizeProduct(item);
          if (String(copy.image || "").startsWith("data:")) {
            const blob = await (await fetch(copy.image)).blob();
            copy.image = await uploadImageFile(new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" }));
          }
          next.push(copy);
        }
        await saveProducts(next);
      }
    }
    const localServices = JSON.parse(localStorage.getItem(TAMSUN_SERVICES_KEY) || "null");
    if (Array.isArray(localServices) && localServices.length) {
      const pick = (item) => String(item.id || "") + String(item.title || "");
      const serverSig = catalogSignature(loadServices(), pick);
      const localSig = catalogSignature(localServices, pick);
      const defaultSig = catalogSignature(DEFAULT_SERVICES, pick);
      if (serverSig === defaultSig && localSig !== defaultSig) await saveServices(localServices);
    }
    const localSettings = JSON.parse(localStorage.getItem(TAMSUN_SETTINGS_KEY) || "null");
    const serverSettings = getServerSettings();
    if (localSettings && serverSettings.usdRate === DEFAULT_SETTINGS.usdRate && serverSettings.currency === "kzt") {
      const rate = Number(localSettings.usdRate);
      const currency = localSettings.currency === "usd" ? "usd" : "kzt";
      if ((rate > 0 && rate !== DEFAULT_SETTINGS.usdRate) || currency !== "kzt") {
        await saveServerSettings({ currency, usdRate: rate > 0 ? rate : DEFAULT_SETTINGS.usdRate });
      }
    }
    sessionStorage.setItem("tamsun_migrated_v1", "1");
  } catch (error) {
    console.error("catalog_migrate_failed");
    try {
      if (!sessionStorage.getItem("tamsun_migrate_warned")) {
        sessionStorage.setItem("tamsun_migrate_warned", "1");
        window.alert("Не удалось перенести локальный каталог на сервер. Войдите в админку ещё раз.");
      }
    } catch (warnError) {}
  }
}

function emptyProduct() {
  return {
    id: "",
    name: "",
    label: "",
    price: "",
    currency: getCurrency(),
    size: "",
    material: "",
    origin: "",
    description: "",
    image: "",
    visible: true,
    file: null,
    preview: "",
  };
}

function emptyService() {
  return { id: "", title: "", description: "", visible: true };
}

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(() => isAdminLoggedIn());
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [tab, setTab] = useState("catalog");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalKind, setModalKind] = useState("product");
  const [modalLock, setModalLock] = useState(false);
  const [productDraft, setProductDraft] = useState(emptyProduct);
  const [serviceDraft, setServiceDraft] = useState(emptyService);
  const [rate, setRate] = useState("");
  const [siteCurrency, setSiteCurrency] = useState("kzt");
  const [orders, setOrders] = useState([]);
  const [clientsCache, setClientsCache] = useState([]);
  const [orderFilter, setOrderFilter] = useState("all");
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [ordersError, setOrdersError] = useState(false);
  const [clientsError, setClientsError] = useState(false);
  const [notes, setNotes] = useState({});
  const [clientNotes, setClientNotes] = useState({});
  const [formNonce, setFormNonce] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState("");
  const version = useStoreVersion();
  const expired = useRef(false);
  const serverOk = useRef(false);
  const ordersRef = useRef([]);
  const ordersCursor = useRef("");
  const clientEtag = useRef("");
  const savingProduct = useRef(false);
  const modalSession = useRef(0);
  const previewUrl = useRef("");
  const booted = useRef(false);
  const refreshRef = useRef(async () => {});
  const pullSeq = useRef(0);
  const saveDone = useRef(0);

  const products = loadProducts();
  const services = loadServices();
  const freshOrders = orders.filter((item) => item.status === "new").length;
  const clients = clientsForView(orders, clientsCache).filter((client) => client.orders.length > 0);
  const pendingCount = readPendingOrders().length;

  function forceLogout() {
    if (expired.current) return;
    expired.current = true;
    booted.current = false;
    setAdminLoggedIn(false);
    setLoggedIn(false);
    setModalOpen(false);
    alert("Сессия истекла. Войдите снова.");
  }

  function syncSettings() {
    const settings = getServerSettings();
    setRate(String(settings.usdRate));
    setSiteCurrency(settings.currency);
  }

  function revokePreview() {
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = "";
    }
  }

  function closeModal() {
    modalSession.current += 1;
    setModalOpen(false);
    setModalLock(false);
    setProductDraft(emptyProduct());
    setServiceDraft(emptyService());
    setFormNonce((value) => value + 1);
    revokePreview();
  }

  function openProductForm(product) {
    revokePreview();
    setFormNonce((value) => value + 1);
    setServiceDraft(emptyService());
    if (!product) {
      setProductDraft(emptyProduct());
      setModalKind("product");
      setModalLock(false);
      setModalOpen(true);
      return;
    }
    const currency = getCurrency();
    setProductDraft({
      id: product.id,
      name: product.name || "",
      label: product.label || "",
      price: String(Math.round(convertFromKzt(getProductPriceKzt(product), currency) * 100) / 100),
      currency,
      size: product.size || "",
      material: product.material || "",
      origin: product.origin || "",
      description: product.description || "",
      image: product.image || "",
      visible: product.visible !== false,
      file: null,
      preview: product.image || "",
    });
    setModalKind("product");
    setModalLock(true);
    setModalOpen(true);
  }

  function openServiceForm(service) {
    revokePreview();
    setFormNonce((value) => value + 1);
    setProductDraft(emptyProduct());
    if (!service) {
      setServiceDraft(emptyService());
      setModalKind("service");
      setModalLock(false);
      setModalOpen(true);
      return;
    }
    setServiceDraft({
      id: service.id,
      title: service.title || "",
      description: service.description || "",
      visible: service.visible !== false,
    });
    setModalKind("service");
    setModalLock(true);
    setModalOpen(true);
  }

  async function refreshOrders(options = {}) {
    const seq = ++pullSeq.current;
    const savedAtStart = saveDone.current;
    let nextOrders = ordersRef.current;
    let error = false;
    let ok = serverOk.current;
    let nextCursor = ordersCursor.current;
    let nextClients = null;
    let nextClientEtag = clientEtag.current;
    let clientsFailed = false;
    try {
      const since = ordersCursor.current;
      const ordersUrl = since ? "/api/orders?since=" + encodeURIComponent(since) : "/api/orders";
      const response = await apiFetch(ordersUrl, { headers: adminHeaders() });
      if (response.status === 401) {
        forceLogout();
        return;
      }
      if (!response.ok) throw new Error("load");
      const data = await response.json();
      const incoming = asArray(data && data.orders);
      const replace = !since || data.full !== false;
      if (replace) nextOrders = incoming;
      else {
        const map = new Map(ordersRef.current.map((order) => [order.id, order]));
        asArray(data && data.deletedIds).forEach((id) => map.delete(String(id || "")));
        incoming.forEach((order) => {
          if (order && order.id) map.set(order.id, order);
        });
        nextOrders = Array.from(map.values());
      }
      if (data && data.serverTime) nextCursor = String(data.serverTime);
      error = false;
      ok = true;
      if (!options.skipLegacy && localStorage.getItem("tamsun_orders_local")) {
        await adoptLegacyLocalOrders(nextOrders);
        serverOk.current = true;
        await refreshOrders({ skipLegacy: true });
        return;
      }
    } catch (loadError) {
      error = true;
      if (!serverOk.current) nextOrders = [];
    }
    nextOrders = nextOrders.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    try {
      const headers = adminHeaders();
      if (clientEtag.current) headers["If-None-Match"] = clientEtag.current;
      const response = await apiFetch("/api/clients", { headers });
      if (response.status === 401) {
        forceLogout();
        return;
      }
      if (response.status === 304) nextClients = null;
      else if (response.ok) {
        const data = await response.json();
        const list = data && data.clients;
        nextClients = Array.isArray(list) ? list : list ? [list] : [];
        nextClientEtag = response.headers.get("ETag") || "";
      } else {
        clientsFailed = true;
      }
    } catch (loadError) {
      nextClients = null;
      clientsFailed = true;
    }
    await flushPendingOrders();
    if (seq !== pullSeq.current || savedAtStart !== saveDone.current) return;
    serverOk.current = ok;
    ordersCursor.current = nextCursor;
    clientEtag.current = nextClientEtag;
    ordersRef.current = nextOrders;
    setOrders(nextOrders);
    if (nextClients) setClientsCache(nextClients);
    setOrdersError(error);
    setClientsError(clientsFailed);
    setOrdersLoaded(true);
  }

  refreshRef.current = refreshOrders;

  useEffect(() => {
    document.title = "Админка — Tamsun Shop";
    document.body.classList.add("admin-body");
    const onWheel = (event) => {
      const target = event.target;
      if (target && target.matches && target.matches('input[type="number"]')) event.preventDefault();
    };
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      document.body.classList.remove("admin-body");
      document.body.classList.remove("admin-modal-open");
      document.removeEventListener("wheel", onWheel);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("admin-modal-open", modalOpen);
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  useEffect(() => {
    if (!loggedIn) return undefined;
    syncSettings();
    migrateLocalCatalog();
    let alive = true;
    refreshRef.current().then(() => {
      if (alive && !booted.current) {
        booted.current = true;
        setTab("orders");
      }
    });
    const timer = setInterval(() => {
      refreshRef.current();
    }, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn || modalOpen) return;
    syncSettings();
  }, [version, loggedIn, modalOpen]);

  async function downloadCatalogPdf() {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const response = await apiFetch("/api/catalog.pdf", { headers: adminHeaders(), timeout: 70000 });
      if (response.status === 401) {
        forceLogout();
        return;
      }
      if (!response.ok) throw new Error("pdf");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "tamsun-catalog.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert("Не удалось собрать PDF-каталог. Обновите страницу и попробуйте ещё раз.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadInvoice(order) {
    if (!order || invoiceBusy) return;
    setInvoiceBusy(order.id);
    try {
      const response = await apiFetch("/api/orders/" + encodeURIComponent(order.id) + "/invoice.pdf", { headers: adminHeaders(), timeout: 70000 });
      if (response.status === 401) {
        forceLogout();
        return;
      }
      if (!response.ok) throw new Error("pdf");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "tamsun-invoice-" + (Number(order.number) || order.id) + ".pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert("Не удалось собрать счёт-фактуру. Обновите страницу и попробуйте ещё раз.");
    } finally {
      setInvoiceBusy("");
    }
  }

  async function onLogin(event) {
    event.preventDefault();
    try {
      const response = await apiFetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) {
        alert("Неверный пароль");
        return;
      }
      expired.current = false;
      setAdminToken(data.token);
      setPassword("");
      setLoggedIn(true);
    } catch (error) {
      alert("Сервер не отвечает. Обновите страницу и попробуйте ещё раз.");
    }
  }

  async function onSaveProduct(event) {
    event.preventDefault();
    if (savingProduct.current) return;
    const session = modalSession.current;
    savingProduct.current = true;
    try {
      const list = loadProducts();
      const id = productDraft.id || createId();
      let image = productDraft.image.trim();
      if (productDraft.file) image = await uploadImageFile(productDraft.file);
      if (String(image).startsWith("data:")) {
        const blob = await (await fetch(image)).blob();
        image = await uploadImageFile(new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" }));
      }
      const next = {
        id,
        name: productDraft.name.trim(),
        label: productDraft.label.trim(),
        priceKzt: convertToKzt(productDraft.price, productDraft.currency),
        size: productDraft.size.trim(),
        material: productDraft.material.trim(),
        origin: productDraft.origin.trim(),
        description: productDraft.description.trim(),
        image,
        visible: productDraft.visible,
      };
      if (!next.image) {
        alert("Добавьте фото товара");
        return;
      }
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0) list[index] = next;
      else list.unshift(next);
      await saveProducts(list);
      if (session !== modalSession.current) return;
      closeModal();
    } catch (error) {
      if (error && error.message === "unauthorized") {
        forceLogout();
        return;
      }
      if (error && error.message === "too_large") {
        alert("Фото слишком большое. Выберите снимок поменьше.");
        return;
      }
      if (error && error.message === "too_many") {
        alert("В каталоге может быть не больше 1000 товаров.");
        return;
      }
      alert("Не удалось сохранить товар. Обновите страницу и попробуйте ещё раз.");
    } finally {
      savingProduct.current = false;
    }
  }

  async function onSaveService(event) {
    event.preventDefault();
    if (savingProduct.current) return;
    const session = modalSession.current;
    savingProduct.current = true;
    const list = loadServices();
    const id = serviceDraft.id || createId();
    const next = {
      id,
      title: serviceDraft.title.trim(),
      description: serviceDraft.description.trim(),
      visible: serviceDraft.visible,
    };
    const index = list.findIndex((item) => item.id === id);
    if (index >= 0) list[index] = next;
    else list.push(next);
    try {
      await saveServices(list);
      if (session !== modalSession.current) return;
      closeModal();
    } catch (error) {
      if (error && error.message === "unauthorized") forceLogout();
      else if (error && error.message === "too_many") alert("Услуг может быть не больше 400.");
      else alert("Не удалось сохранить услугу.");
    } finally {
      savingProduct.current = false;
    }
  }

  async function onSaveSettings() {
    try {
      await saveServerSettings({ usdRate: rate, currency: siteCurrency });
      syncSettings();
      alert("Настройки валюты сохранены для всего сайта");
    } catch (error) {
      if (error && error.message === "unauthorized") forceLogout();
      else alert("Не удалось сохранить настройки.");
    }
  }

  async function removeProduct(id) {
    if (!confirm("Удалить этот товар?")) return;
    try {
      await saveProducts(loadProducts().filter((item) => item.id !== id));
    } catch (error) {
      if (error && error.message === "unauthorized") forceLogout();
      else alert("Не удалось удалить товар.");
    }
  }

  async function removeService(id) {
    if (!confirm("Удалить эту услугу?")) return;
    try {
      await saveServices(loadServices().filter((item) => item.id !== id));
    } catch (error) {
      if (error && error.message === "unauthorized") forceLogout();
      else alert("Не удалось удалить услугу.");
    }
  }

  async function saveOrder(id, status, note) {
    const previous = ordersRef.current;
    const apply = (list) => list.map((order) => (order.id === id ? { ...order, status, note } : order));
    ordersRef.current = apply(previous);
    setOrders(ordersRef.current);
    const response = await apiFetch("/api/orders", {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ id, status, note }),
    });
    if (response.status === 401) {
      forceLogout();
      return;
    }
    if (!response.ok) {
      ordersRef.current = previous;
      setOrders(previous);
      alert("Не удалось сохранить заказ");
      return;
    }
    saveDone.current += 1;
    setOrders((current) => {
      const next = apply(current);
      ordersRef.current = next;
      return next;
    });
  }

  async function saveClientNote(key, note) {
    const response = await apiFetch("/api/clients", {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ key, note }),
    });
    if (response.status === 401) {
      forceLogout();
      return;
    }
    if (!response.ok) {
      alert("Не удалось сохранить комментарий");
      return;
    }
    setClientsCache((current) => current.map((client) => (client.key === key ? { ...client, note } : client)));
  }

  async function deleteOrder(id) {
    if (!confirm("Удалить этот заказ?")) return;
    const response = await apiFetch("/api/orders", {
      method: "DELETE",
      headers: adminHeaders(),
      body: JSON.stringify({ id }),
    });
    if (response.status === 401) {
      forceLogout();
      return;
    }
    if (!response.ok) {
      alert("Не удалось удалить заказ");
      return;
    }
    await refreshOrders({ skipLegacy: true });
  }

  const visibleOrders = orders.filter((item) => orderFilter === "all" || item.status === orderFilter);
  const modalTitle =
    modalKind === "service" ? (serviceDraft.id ? "Изменить услугу" : "Новая услуга") : productDraft.id ? "Изменить товар" : "Новый товар";
  const previewSrc = mediaUrl(productDraft.preview || productDraft.image);

  return (
    <div className="admin-wrap">
      <header className="admin-top">
        <Link className="admin-brand" to="/">
          <BrandLogo />
        </Link>
        <div className="admin-top-actions">
          <Link to="/products">На сайт</Link>
          <button
            type="button"
            id="logout-btn"
            hidden={!loggedIn}
            onClick={() => {
              setAdminLoggedIn(false);
              booted.current = false;
              setLoggedIn(false);
              closeModal();
            }}
          >
            Выйти
          </button>
        </div>
      </header>

      {!loggedIn ? (
        <section className="admin-login" id="login-panel">
          <h1>Админка магазина</h1>
          <p>Войдите, чтобы вести каталог и заказы, которые клиенты отправляют в WhatsApp.</p>
          <form id="login-form" onSubmit={onLogin}>
            <label>
              Пароль
              <span className="admin-pass-field">
                <input
                  type={showPassword ? "text" : "password"}
                  id="admin-pass"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className={showPassword ? "admin-pass-toggle is-visible" : "admin-pass-toggle"}
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  <svg className="admin-eye" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <svg className="admin-eye-off" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 3l18 18" />
                    <path d="M10.6 6.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.4 4.1" />
                    <path d="M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.5 0 2.9-.4 4.1-1" />
                    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                  </svg>
                </button>
              </span>
            </label>
            <button type="submit">Войти</button>
          </form>
        </section>
      ) : (
        <section className="admin-app" id="app-panel">
          <nav className="admin-tabs" id="admin-tabs">
            <button type="button" className={tab === "catalog" ? "is-active" : ""} onClick={() => setTab("catalog")}>
              Каталог
            </button>
            <button
              type="button"
              className={tab === "orders" ? "is-active" : ""}
              onClick={() => {
                setTab("orders");
                refreshOrders();
              }}
            >
              Заказы {freshOrders > 0 ? <span id="orders-count">{freshOrders}</span> : <span id="orders-count" hidden />}
            </button>
            <button
              type="button"
              className={tab === "clients" ? "is-active" : ""}
              onClick={() => {
                setTab("clients");
                refreshOrders();
              }}
            >
              Клиенты {clients.length > 0 ? <span id="clients-count">{clients.length}</span> : <span id="clients-count" hidden />}
            </button>
          </nav>

          {tab === "catalog" ? (
            <div id="catalog-panel">
              <div className="admin-head">
                <h1>Товары</h1>
                <div className="admin-head-actions">
                  <button type="button" onClick={downloadCatalogPdf} disabled={pdfBusy}>
                    {pdfBusy ? "Собираю PDF…" : "Скачать PDF"}
                  </button>
                  <button type="button" className="admin-primary" onClick={() => openProductForm(null)}>
                    + Новый товар
                  </button>
                </div>
              </div>
              <div className="admin-settings">
                <label>
                  Курс USD
                  <input type="number" id="usd-rate" min="1" step="1" value={rate} onChange={(event) => setRate(event.target.value)} />
                </label>
                <label>
                  Валюта на сайте
                  <select id="site-currency" value={siteCurrency} onChange={(event) => setSiteCurrency(event.target.value)}>
                    <option value="kzt">Тенге (₸)</option>
                    <option value="usd">Доллары ($)</option>
                  </select>
                </label>
                <button type="button" onClick={onSaveSettings}>
                  Сохранить курс
                </button>
              </div>
              <div className="admin-list" id="product-list">
                {products.length ? (
                  products.map((item) => (
                    <article className={item.visible === false ? "admin-card is-off" : "admin-card"} key={item.id}>
                      <div className="admin-card-media">
                        <img src={mediaUrl(item.image)} alt={item.name} />
                      </div>
                      <div className="admin-card-body">
                        <p className="admin-card-label">{item.label || ""}</p>
                        <h2>{item.name}</h2>
                        <p className="admin-card-price">{formatPrice(getProductPriceKzt(item), getCurrency())}</p>
                        <p className={item.visible === false ? "admin-card-status is-off" : "admin-card-status"}>
                          {item.visible === false ? "Скрыт" : "В магазине"}
                        </p>
                        <div className="admin-card-actions">
                          <button type="button" onClick={() => openProductForm(item)}>
                            Изменить
                          </button>
                          <button type="button" className="danger" onClick={() => removeProduct(item.id)}>
                            Удалить
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="admin-empty">Пока нет товаров. Нажмите «Новый товар».</p>
                )}
              </div>
              <div className="admin-head admin-head-services">
                <h1>Услуги</h1>
                <button type="button" className="admin-primary" onClick={() => openServiceForm(null)}>
                  + Новая услуга
                </button>
              </div>
              <div className="admin-list" id="service-list">
                {services.length ? (
                  services.map((item) => (
                    <article className={item.visible === false ? "admin-card admin-service-card is-off" : "admin-card admin-service-card"} key={item.id}>
                      <div className="admin-card-body admin-service-body">
                        <h2>{item.title}</h2>
                        <p className="admin-service-text">{item.description || ""}</p>
                        <p className={item.visible === false ? "admin-card-status is-off" : "admin-card-status"}>
                          {item.visible === false ? "Скрыта" : "На сайте"}
                        </p>
                        <div className="admin-card-actions">
                          <button type="button" onClick={() => openServiceForm(item)}>
                            Изменить
                          </button>
                          <button type="button" className="danger" onClick={() => removeService(item.id)}>
                            Удалить
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="admin-empty">Пока нет услуг. Нажмите «Новая услуга».</p>
                )}
              </div>
            </div>
          ) : null}

          {tab === "orders" ? (
            <div id="orders-panel">
              <div className="admin-head">
                <h1>Заказы</h1>
              </div>
              <p className="admin-orders-lead">
                Заявка сохраняется, когда клиент указывает имя и телефон и нажимает «Отправить заявку». WhatsApp открывается следом. Если окно не открылось, заявка всё равно уже в списке.
              </p>
              <div className="admin-filters" id="order-filters">
                {[
                  ["all", "Все"],
                  ["new", "Новые"],
                  ["progress", "В работе"],
                  ["done", "Готово"],
                  ["cancelled", "Отменённые"],
                ].map(([value, label]) => (
                  <button type="button" key={value} className={orderFilter === value ? "is-active" : ""} onClick={() => setOrderFilter(value)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="admin-list admin-grid-3" id="order-list">
                {!ordersLoaded ? <p className="admin-empty">Загружаю заказы…</p> : null}
                {ordersLoaded && ordersError && !serverOk.current ? (
                  <p className="admin-empty">Не удалось загрузить заказы. Обновите страницу.</p>
                ) : null}
                {ordersLoaded && (serverOk.current || !ordersError) ? (
                  <>
                    {ordersError ? <p className="admin-empty">Не удалось обновить заказы. Показан последний успешный список.</p> : null}
                    {pendingCount ? (
                      <p className="admin-empty">
                        На этом браузере {pendingCount} заявок ещё не подтверждены сервером. Они отправятся сами, когда связь появится.
                      </p>
                    ) : null}
                    {!visibleOrders.length ? <p className="admin-empty">Пока нет заказов. Они появятся, когда клиент отправит заявку на сайте.</p> : null}
                    {visibleOrders.map((order) => {
                      const items = orderItems(order);
                      const replyHref = managerWhatsAppLink(order);
                      const customerName = String(order.customerName || "").trim();
                      const customerPhone = String(order.customerPhone || "").trim();
                      const phoneDigits = customerPhone.replace(/\D/g, "");
                      const message = String(order.message || "").trim();
                      const noteValue = Object.prototype.hasOwnProperty.call(notes, order.id) ? notes[order.id] : order.note || "";
                      return (
                        <article className="order-card" data-status={order.status || "new"} key={order.id}>
                          <div className="order-card-top">
                            <p className="order-kicker">
                              № {Number(order.number) || "—"} · {ORDER_SOURCES[order.source] || "WhatsApp"}
                            </p>
                            <select
                              className="order-status"
                              value={order.status || "new"}
                              onChange={(event) => saveOrder(order.id, event.target.value, noteValue)}
                            >
                              {ORDER_STATUSES.map(([value, label]) => (
                                <option value={value} key={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="order-card-person">
                            <h2>{customerName || formatOrderWhen(order.createdAt)}</h2>
                            {customerName ? <p className="order-when">{formatOrderWhen(order.createdAt)}</p> : null}
                            {customerPhone ? (
                              <p className="order-phone">
                                <a href={"tel:+" + phoneDigits}>{customerPhone}</a>
                              </p>
                            ) : null}
                          </div>
                          <button type="button" className="order-invoice" onClick={() => downloadInvoice(order)} disabled={invoiceBusy === order.id}>
                            {invoiceBusy === order.id ? "Собираю…" : "Скачать счет-фактуру"}
                          </button>
                          {items.length ? (
                            <ul className="order-items">
                              {items.map((item, index) => (
                                <li className="is-line" key={index}>
                                  <span className="order-item-name">
                                    {item.name} × {Number(item.qty) || 1}
                                  </span>
                                  <span className="order-item-price">{formatMoney(item.lineTotalKzt, order.currency, order.usdRate)}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {items.length ? <p className="order-total">Итого: {formatMoney(order.totalKzt, order.currency, order.usdRate)}</p> : null}
                          {message ? (
                            <details className="order-brief">
                              <summary>Текст заявки</summary>
                              <p>{message}</p>
                            </details>
                          ) : null}
                          <label className="order-note">
                            Заметка
                            <textarea
                              rows={2}
                              placeholder="Договорённость"
                              value={noteValue}
                              onChange={(event) => setNotes((current) => ({ ...current, [order.id]: event.target.value }))}
                            />
                          </label>
                          <div className="order-card-actions">
                            <button type="button" onClick={() => saveOrder(order.id, order.status || "new", noteValue)}>
                              Сохранить
                            </button>
                            {replyHref ? (
                              <a href={replyHref} target="_blank" rel="noopener noreferrer">
                                WhatsApp
                              </a>
                            ) : null}
                            <button type="button" className="danger" onClick={() => deleteOrder(order.id)}>
                              Удалить
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === "clients" ? (
            <div id="clients-panel">
              <div className="admin-head">
                <h1>Клиенты</h1>
              </div>
              <p className="admin-orders-lead">
                Один номер — один клиент. Повторная заявка дополняет его. Если заказов не осталось, клиент исчезает из списка. Сумма считается в тенге и без отменённых заявок.
              </p>
              <div className="admin-list admin-grid-3" id="client-list">
                {!ordersLoaded ? <p className="admin-empty">Загружаю клиентов…</p> : null}
                {ordersLoaded && (ordersError || clientsError) && !orders.length && !clients.length ? (
                  <p className="admin-empty">Не удалось загрузить клиентов. Обновите страницу.</p>
                ) : null}
                {clientsError && (orders.length || clients.length) ? (
                  <p className="admin-empty">Не удалось обновить клиентов. Показан последний успешный список.</p>
                ) : null}
                {ordersLoaded && (orders.length || !ordersError) ? (
                  clients.length ? (
                    clients.map((client) => {
                      const phoneDigits = client.phone.replace(/\D/g, "");
                      const replyHref = managerWhatsAppLink(client.latest || { customerName: client.name, customerPhone: client.phone, items: [] });
                      const commentValue = Object.prototype.hasOwnProperty.call(clientNotes, client.key) ? clientNotes[client.key] : client.note || "";
                      return (
                        <article className="order-card client-card" key={client.key}>
                          <div className="order-card-person">
                            <p className="order-kicker">{clientRequestLabel(client)}</p>
                            <h2>{client.name || "Без имени"}</h2>
                            {client.latest ? <p className="order-when">Последняя заявка {formatOrderWhen(client.latest.createdAt)}</p> : null}
                          </div>
                          {client.phone ? (
                            <p className="order-phone">
                              <a href={"tel:+" + phoneDigits}>{client.phone}</a>
                            </p>
                          ) : null}
                          {client.orders.length ? (
                            <ul className="order-items">
                              {client.orders.map((order) => (
                                <li className="is-stack" key={order.id}>
                                  <span className="order-item-name">
                                    № {Number(order.number) || "—"} · {goodsLabel(order) || "Заявка"}
                                  </span>
                                  <span className="order-item-aside">
                                    <span className={"order-status-label is-" + (order.status || "new")}>{orderStatusLabel(order.status)}</span>
                                    <span className="order-item-price">{formatMoney(order.totalKzt, order.currency, order.usdRate)}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <p className="order-total">Сумма заявок: {formatMoney(client.total, "kzt")}</p>
                          <label className="order-note">
                            Комментарий
                            <textarea
                              rows={3}
                              placeholder="Заметка о клиенте"
                              value={commentValue}
                              onChange={(event) => setClientNotes((current) => ({ ...current, [client.key]: event.target.value }))}
                            />
                          </label>
                          <div className="order-card-actions">
                            <button type="button" onClick={() => saveClientNote(client.key, commentValue)}>
                              Сохранить
                            </button>
                            {replyHref ? (
                              <a href={replyHref} target="_blank" rel="noopener noreferrer">
                                WhatsApp
                              </a>
                            ) : null}
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <p className="admin-empty">Пока нет клиентов. Они появятся, когда кто-то оставит заявку на сайте.</p>
                  )
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      )}

      <div className="admin-modal" id="admin-modal" hidden={!modalOpen}>
        <div className="admin-modal-backdrop" onClick={closeModal} />
        <div className="admin-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
          <div className="admin-modal-head">
            <h2 id="admin-modal-title">{modalTitle}</h2>
            <button type="button" className="admin-modal-close" aria-label="Закрыть" onClick={closeModal}>
              ×
            </button>
          </div>
          <label className="admin-modal-type" id="modal-type-wrap">
            Тип
            <select
              id="modal-type"
              value={modalKind}
              disabled={modalLock}
              onChange={(event) => {
                const type = event.target.value;
                setModalKind(type);
              }}
            >
              <option value="product">Товар</option>
              <option value="service">Услуга</option>
            </select>
          </label>

          {modalKind === "product" ? (
            <form className="admin-form admin-form-modal" id="product-form" onSubmit={onSaveProduct}>
              <div className="admin-form-grid">
                <label>
                  Название
                  <input required placeholder="Панно «Бес қару»" value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} />
                </label>
                <label>
                  Подпись / лейбл
                  <input placeholder="Bes Qaru" value={productDraft.label} onChange={(event) => setProductDraft({ ...productDraft, label: event.target.value })} />
                </label>
                <label>
                  Цена
                  <input type="number" min="0" step="any" required placeholder="85000" value={productDraft.price} onChange={(event) => setProductDraft({ ...productDraft, price: event.target.value })} />
                </label>
                <label>
                  Валюта цены
                  <select value={productDraft.currency} onChange={(event) => setProductDraft({ ...productDraft, currency: event.target.value })}>
                    <option value="kzt">Тенге (₸)</option>
                    <option value="usd">Доллары ($)</option>
                  </select>
                </label>
                <label>
                  Размер
                  <input placeholder="33 × 21 см" value={productDraft.size} onChange={(event) => setProductDraft({ ...productDraft, size: event.target.value })} />
                </label>
                <label>
                  Материал
                  <input placeholder="МДФ, пластик, нитрид титана" value={productDraft.material} onChange={(event) => setProductDraft({ ...productDraft, material: event.target.value })} />
                </label>
                <label>
                  Производство
                  <input placeholder="Производство: Казахстан" value={productDraft.origin} onChange={(event) => setProductDraft({ ...productDraft, origin: event.target.value })} />
                </label>
                <label className="full">
                  Описание
                  <textarea rows={4} required value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} />
                </label>
                <label className="full">
                  Фото товара
                  <input
                    key={formNonce}
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files && event.target.files[0];
                      if (!file) return;
                      revokePreview();
                      const url = URL.createObjectURL(file);
                      previewUrl.current = url;
                      setProductDraft((current) => ({ ...current, file, preview: url }));
                    }}
                  />
                </label>
                <label className="full">
                  Или ссылка / путь к фото
                  <input
                    placeholder="product-bes-qaru.jpg"
                    value={productDraft.image}
                    onChange={(event) => {
                      revokePreview();
                      const next = event.target.value;
                      setProductDraft((current) => ({ ...current, file: null, image: next, preview: next.trim() }));
                    }}
                  />
                </label>
                <label className="check">
                  <input type="checkbox" checked={productDraft.visible} onChange={(event) => setProductDraft({ ...productDraft, visible: event.target.checked })} />
                  Показывать в магазине
                </label>
              </div>
              <div className="admin-preview" hidden={!previewSrc}>
                {previewSrc ? <img alt="Превью" src={previewSrc} /> : null}
              </div>
              <div className="admin-form-actions">
                <button type="submit" className="admin-primary">
                  Сохранить
                </button>
                <button type="button" onClick={closeModal}>
                  Отмена
                </button>
              </div>
            </form>
          ) : (
            <form className="admin-form admin-form-modal" id="service-form" onSubmit={onSaveService}>
              <div className="admin-form-grid">
                <label className="full">
                  Название услуги
                  <input required placeholder="Разработка сувениров" value={serviceDraft.title} onChange={(event) => setServiceDraft({ ...serviceDraft, title: event.target.value })} />
                </label>
                <label className="full">
                  Описание
                  <textarea rows={4} required value={serviceDraft.description} onChange={(event) => setServiceDraft({ ...serviceDraft, description: event.target.value })} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={serviceDraft.visible} onChange={(event) => setServiceDraft({ ...serviceDraft, visible: event.target.checked })} />
                  Показывать на сайте
                </label>
              </div>
              <div className="admin-form-actions">
                <button type="submit" className="admin-primary">
                  Сохранить
                </button>
                <button type="button" onClick={closeModal}>
                  Отмена
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
