export const TAMSUN_STORE_KEY = "tamsun_products_v1";
export const TAMSUN_SETTINGS_KEY = "tamsun_settings_v1";
export const TAMSUN_SERVICES_KEY = "tamsun_services_v2";
export const TAMSUN_CART_KEY = "tamsun_cart_v1";
export const TAMSUN_ADMIN_TOKEN = "tamsun_admin_token";
export const TAMSUN_CURRENCY_PREF = "tamsun_currency_pref";
export const TAMSUN_CATALOG_CACHE = "tamsun_catalog_cache_v1";
export const TAMSUN_PENDING_ORDERS = "tamsun_orders_pending";
export const TAMSUN_PHONE = "77012271505";
export const CART_MAX_QTY = 99;

export const DEFAULT_SETTINGS = {
  currency: "kzt",
  usdRate: 500,
};

export const DEFAULT_PRODUCTS = [
  {
    id: "bes-qaru",
    name: "Панно «Бес қару»",
    label: "Bes Qaru",
    description:
      "Древний символ степной воинской традиции — «пять видов оружия». Это не про оружие, а про силу характера, честь и ответственность.",
    priceKzt: 85000,
    image: "product-bes-qaru.jpg",
    size: "33 × 21 см",
    material: "МДФ, пластик, нитрид титана",
    origin: "Производство: Казахстан",
    visible: true,
  },
  {
    id: "dala-uni",
    name: "Панно «Дала үні»",
    label: "Dala Uni",
    description:
      "«Зов степи» — голос предков через образ традиционных инструментов и кочевой культуры. Символ памяти и культурной преемственности.",
    priceKzt: 85000,
    image: "product-dala-uni.jpg",
    size: "33 × 21 см",
    material: "МДФ, пластик, нитрид титана",
    origin: "Производство: Казахстан",
    visible: true,
  },
  {
    id: "jeti-qazyna",
    name: "Панно «Жеті қазына»",
    label: "Jeti Qazyna",
    description:
      "Семь сокровищ — образ благополучия, мудрости и единства. Дарят с пожеланием процветания, партнёрства и уверенного развития.",
    priceKzt: 95000,
    image: "product-jeti-qazyna.jpg",
    size: "30 × 30 см",
    material: "МДФ, пластик, нитрид титана",
    origin: "Производство: Казахстан",
    visible: true,
  },
];

export const DEFAULT_SERVICES = [
  {
    id: "souvenirs",
    title: "Разработка сувениров",
    description:
      "Корпоративный символ, национальный мотив или подарок к событию — придумаем концепцию и реализуем в металле, дереве, керамике или смешанных техниках.",
    visible: true,
  },
  {
    id: "cups",
    title: "Кубки и награды",
    description:
      "Кубки, статуэтки и наградная продукция для турниров, церемоний и деловых мероприятий. Дизайн под ваш бренд и статус события.",
    visible: true,
  },
  {
    id: "gifts",
    title: "Индивидуальные подарки",
    description:
      "Персональные изделия для послов, партнёров и особых гостей. Тираж от одной штуки — с историей, которую хочется сохранить.",
    visible: true,
  },
];

export function apiUrl(path) {
  return path;
}

export function apiFetch(path, options = {}) {
  const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 15000;
  const rest = { ...options };
  delete rest.timeout;
  const callerSignal = rest.signal;
  delete rest.signal;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const onAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onAbort, { once: true });
  }
  return fetch(apiUrl(path), { ...rest, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", onAbort);
  });
}

export function mediaUrl(src) {
  const value = String(src || "").trim();
  if (!value) return "";
  if (/^(https?:|data:|blob:)/i.test(value) || value.startsWith("//")) return value;
  return "/" + value.replace(/^\.?\//, "");
}

export function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function readCatalogCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TAMSUN_CATALOG_CACHE) || "null");
    if (!parsed || !Array.isArray(parsed.products) || !Array.isArray(parsed.services)) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

let catalogState = {
  products: null,
  services: null,
  settings: null,
};
let catalogStamp = "";
let catalogEtag = "";
let catalogFlags = { loaded: false, isError: false, stale: false };

export function getCatalogState() {
  return catalogFlags;
}

let catalogCacheLogged = false;
function writeCatalogCache() {
  if (!Array.isArray(catalogState.products) || !Array.isArray(catalogState.services)) return;
  try {
    localStorage.setItem(
      TAMSUN_CATALOG_CACHE,
      JSON.stringify({
        products: catalogState.products,
        services: catalogState.services,
        settings: catalogState.settings || DEFAULT_SETTINGS,
      })
    );
  } catch (error) {
    if (!catalogCacheLogged) {
      catalogCacheLogged = true;
      console.error("catalog_cache_failed");
    }
  }
}

function emit(name) {
  window.dispatchEvent(new CustomEvent(name));
}

export function subscribeStore(listener) {
  const names = ["tamsun-store", "tamsun-catalog-updated", "tamsun-cart-updated"];
  names.forEach((name) => window.addEventListener(name, listener));
  return () => names.forEach((name) => window.removeEventListener(name, listener));
}

export function getServerSettings() {
  const settings = catalogState.settings || (readCatalogCache() && readCatalogCache().settings) || DEFAULT_SETTINGS;
  const rate = Number(settings.usdRate);
  return {
    currency: settings.currency === "usd" ? "usd" : "kzt",
    usdRate: rate > 0 ? rate : DEFAULT_SETTINGS.usdRate,
  };
}

let currencyPrefLogged = false;
export function getCurrency() {
  try {
    const pref = localStorage.getItem(TAMSUN_CURRENCY_PREF);
    if (pref === "usd" || pref === "kzt") return pref;
    const old = JSON.parse(localStorage.getItem(TAMSUN_SETTINGS_KEY) || "null");
    if (old && (old.currency === "usd" || old.currency === "kzt")) return old.currency;
  } catch (error) {
    if (!currencyPrefLogged) {
      currencyPrefLogged = true;
      console.error("currency_pref_failed");
    }
  }
  return getServerSettings().currency;
}

export function setCurrency(currency) {
  localStorage.setItem(TAMSUN_CURRENCY_PREF, currency === "usd" ? "usd" : "kzt");
  emit("tamsun-store");
}

export function getUsdRate() {
  return getServerSettings().usdRate;
}

export function normalizeProduct(item) {
  const priceKzt = item.priceKzt != null ? Number(item.priceKzt) : Number(item.price) || 0;
  return { ...item, priceKzt };
}

export function getProductPriceKzt(product) {
  return Number(normalizeProduct(product).priceKzt) || 0;
}

export function convertFromKzt(amountKzt, currency) {
  const value = Number(amountKzt) || 0;
  if (currency === "usd") return value / getUsdRate();
  return value;
}

export function convertToKzt(amount, currency) {
  const value = Number(amount) || 0;
  if (currency === "usd") return Math.round(value * getUsdRate());
  return Math.round(value);
}

export function formatPrice(amountKzt, currency) {
  return formatMoney(amountKzt, currency || getCurrency(), getUsdRate());
}

export function formatMoney(amountKzt, currency, usdRate) {
  const active = currency === "usd" ? "usd" : "kzt";
  const value = Number(amountKzt) || 0;
  if (active === "usd") {
    const rate = Number(usdRate) > 0 ? Number(usdRate) : getUsdRate();
    const shown = value / rate;
    return (
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(shown) + " $"
    );
  }
  return new Intl.NumberFormat("ru-RU").format(Math.round(value)) + " ₸";
}

export function loadProducts() {
  if (!catalogFlags.loaded || !Array.isArray(catalogState.products)) return [];
  return catalogState.products.map(normalizeProduct);
}

export async function saveProducts(products) {
  const next = products.map(normalizeProduct);
  const response = await apiFetch("/api/products", {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ products: next }),
  });
  if (response.status === 401) throw new Error("unauthorized");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "save");
  }
  catalogState.products = next;
  catalogStamp = JSON.stringify(catalogState);
  writeCatalogCache();
  emit("tamsun-catalog-updated");
}

export function createId() {
  return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

export function adminHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Admin-Token": sessionStorage.getItem(TAMSUN_ADMIN_TOKEN) || "",
  };
}

export function isAdminLoggedIn() {
  return Boolean(sessionStorage.getItem(TAMSUN_ADMIN_TOKEN));
}

export function setAdminToken(token) {
  sessionStorage.setItem(TAMSUN_ADMIN_TOKEN, token);
}

export function setAdminLoggedIn(value) {
  if (!value) sessionStorage.removeItem(TAMSUN_ADMIN_TOKEN);
}

export function loadCart() {
  try {
    const raw = localStorage.getItem(TAMSUN_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export function saveCart(items) {
  localStorage.setItem(TAMSUN_CART_KEY, JSON.stringify(items));
  emit("tamsun-cart-updated");
}

export function getCartCount() {
  if (!catalogFlags.loaded) {
    return loadCart().reduce((sum, item) => {
      const qty = Number(item && item.qty) || 0;
      return sum + (qty > 0 ? qty : 0);
    }, 0);
  }
  return getCartLines().reduce((sum, item) => sum + item.qty, 0);
}

export function getCartTotalKzt() {
  return getCartLines().reduce((sum, item) => sum + item.lineTotalKzt, 0);
}

export function isInCart(productId) {
  return loadCart().some((item) => item.id === productId && Number(item.qty) > 0);
}

export function addToCart(productId, qty) {
  const product = loadProducts().find((item) => item.id === productId);
  if (!product || product.visible === false) return "missing";
  const cart = loadCart();
  const existing = cart.find((item) => item.id === productId);
  if (existing && Number(existing.qty) > 0) return "exists";
  const amount = Math.min(CART_MAX_QTY, Math.max(1, Number(qty) || 1));
  cart.push({ id: productId, qty: amount });
  saveCart(cart);
  return "added";
}

export function setCartQty(productId, qty) {
  const amount = Math.min(CART_MAX_QTY, Math.max(0, Number(qty) || 0));
  let cart = loadCart();
  if (amount <= 0) {
    cart = cart.filter((item) => item.id !== productId);
  } else {
    const existing = cart.find((item) => item.id === productId);
    if (existing) existing.qty = amount;
    else cart.push({ id: productId, qty: amount });
  }
  saveCart(cart);
}

export function removeFromCart(productId) {
  saveCart(loadCart().filter((item) => item.id !== productId));
}

export function clearCart() {
  saveCart([]);
}

export function cartSignature(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const qty = Math.min(CART_MAX_QTY, Math.max(0, Math.round(Number(item && item.qty) || 0)));
      return { id: String((item && item.id) || ""), qty };
    })
    .filter((item) => item.id && item.qty > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => `${item.id}:${item.qty}`)
    .join(",");
}

export function flatOrderItems(items) {
  const rows = [];
  asArray(items).forEach((item) => {
    if (Array.isArray(item)) asArray(item).forEach((inner) => rows.push(inner));
    else if (item) rows.push(item);
  });
  return rows;
}

export function releaseCartAfterOrder(items) {
  const ids = new Set(flatOrderItems(items).map((item) => String((item && item.id) || "")).filter(Boolean));
  if (!ids.size) return;
  const current = loadCart();
  const next = current.filter((item) => !ids.has(String(item.id || "")));
  if (next.length !== current.length) saveCart(next);
}

export function getHiddenCartCount() {
  if (!catalogFlags.loaded) return 0;
  const products = loadProducts();
  return loadCart().filter((item) => {
    const product = products.find((entry) => entry.id === item.id);
    return !product || product.visible === false;
  }).length;
}

export function dropHiddenCartItems() {
  if (!catalogFlags.loaded) return;
  const products = loadProducts();
  const next = loadCart().filter((item) => {
    const product = products.find((entry) => entry.id === item.id);
    return product && product.visible !== false;
  });
  if (next.length !== loadCart().length) saveCart(next);
}

export function getCartLines() {
  const products = loadProducts();
  return loadCart()
    .map((item) => {
      const product = products.find((p) => p.id === item.id);
      if (!product || product.visible === false) return null;
      return {
        ...product,
        qty: Number(item.qty) || 1,
        lineTotalKzt: getProductPriceKzt(product) * (Number(item.qty) || 1),
      };
    })
    .filter(Boolean);
}

export function buildProductWhatsAppLink(product) {
  const currency = getCurrency();
  const price = formatPrice(getProductPriceKzt(product), currency);
  const text = [
    "Здравствуйте! Хочу оформить заказ в Tamsun.",
    `Товар: ${product.name}`,
    product.label ? `Линия: ${product.label}` : "",
    `Цена: ${price}`,
  ]
    .filter(Boolean)
    .join("\n");
  return `https://wa.me/${TAMSUN_PHONE}?text=${encodeURIComponent(text)}`;
}

export function buildCartWhatsAppLink() {
  const currency = getCurrency();
  const lines = getCartLines();
  if (!lines.length) return `https://wa.me/${TAMSUN_PHONE}`;

  const itemsText = lines
    .map((item, index) => `${index + 1}. ${item.name} × ${item.qty} — ${formatPrice(item.lineTotalKzt, currency)}`)
    .join("\n");

  const text = [
    "Здравствуйте! Хочу оформить заказ в Tamsun.",
    "",
    "Корзина:",
    itemsText,
    "",
    `Итого: ${formatPrice(getCartTotalKzt(), currency)}`,
  ].join("\n");

  return `https://wa.me/${TAMSUN_PHONE}?text=${encodeURIComponent(text)}`;
}

export function whatsappLink(text) {
  return `https://wa.me/${TAMSUN_PHONE}?text=${encodeURIComponent(text)}`;
}

function cleanServiceList(parsed) {
  return asArray(parsed)
    .map((item) => ({
      id: item.id || createId(),
      title: String(item.title || "").trim(),
      description: String(item.description || "").trim(),
      visible: item.visible !== false,
    }))
    .filter((item) => item.title);
}

export function loadServices() {
  if (!catalogFlags.loaded || !Array.isArray(catalogState.services)) return [];
  return cleanServiceList(catalogState.services);
}

export async function saveServices(services) {
  const next = cleanServiceList(services);
  const response = await apiFetch("/api/services", {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ services: next }),
  });
  if (response.status === 401) throw new Error("unauthorized");
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "save");
  }
  catalogState.services = next;
  catalogStamp = JSON.stringify(catalogState);
  writeCatalogCache();
  emit("tamsun-catalog-updated");
}

export async function saveServerSettings(settings) {
  const next = {
    currency: settings.currency === "usd" ? "usd" : "kzt",
    usdRate: Number(settings.usdRate) > 0 ? Number(settings.usdRate) : DEFAULT_SETTINGS.usdRate,
  };
  const response = await apiFetch("/api/settings", {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify(next),
  });
  if (response.status === 401) throw new Error("unauthorized");
  if (!response.ok) throw new Error("save");
  catalogState.settings = next;
  catalogStamp = JSON.stringify(catalogState);
  writeCatalogCache();
  emit("tamsun-catalog-updated");
}

export async function refreshCatalog() {
  const headers = {};
  if (catalogEtag) headers["If-None-Match"] = catalogEtag;
  const response = await apiFetch("/api/catalog", { cache: "no-store", headers });
  if (response.status === 304) {
    catalogFlags.loaded = true;
    catalogFlags.isError = false;
    catalogFlags.stale = false;
    return;
  }
  if (!response.ok) throw new Error("catalog");
  const nextEtag = response.headers.get("ETag");
  if (nextEtag) catalogEtag = nextEtag;
  const data = await response.json();
  catalogState.products = asArray(data.products).map(normalizeProduct);
  catalogState.services = cleanServiceList(data.services);
  const settings = data.settings || {};
  catalogState.settings = {
    currency: settings.currency === "usd" ? "usd" : "kzt",
    usdRate: Number(settings.usdRate) > 0 ? Number(settings.usdRate) : DEFAULT_SETTINGS.usdRate,
  };
  catalogFlags.loaded = true;
  catalogFlags.isError = false;
  catalogFlags.stale = false;
  const stamp = JSON.stringify(catalogState);
  if (stamp === catalogStamp) {
    emit("tamsun-catalog-updated");
    return;
  }
  catalogStamp = stamp;
  writeCatalogCache();
  emit("tamsun-catalog-updated");
}

export function retryCatalog() {
  const hadCatalog = catalogFlags.loaded;
  return refreshCatalog().catch((error) => {
    if (hadCatalog) {
      catalogFlags.stale = true;
    } else {
      catalogFlags.loaded = false;
      catalogFlags.isError = true;
    }
    emit("tamsun-catalog-updated");
    throw error;
  });
}

let syncTimer = null;

export function startCatalogSync() {
  if (syncTimer) return () => {};
  const tick = () => {
    refreshCatalog().catch(() => {
      if (catalogFlags.loaded) {
        if (!catalogFlags.stale) {
          catalogFlags.stale = true;
          emit("tamsun-catalog-updated");
        }
        return;
      }
      catalogFlags.isError = true;
      emit("tamsun-catalog-updated");
    });
  };
  tick();
  syncTimer = setInterval(tick, 20000);
  return () => {
    clearInterval(syncTimer);
    syncTimer = null;
  };
}

export function readPendingOrders() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TAMSUN_PENDING_ORDERS) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export function pendingSignature(order) {
  if (!order) return "";
  if (order.source === "cart") {
    const cart = cartSignature(loadCart());
    return cart ? `cart:${cart}` : "";
  }
  const items = cartSignature(order.items);
  if (items) return `${order.source}:${items}`;
  const text = String(order.message || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return text ? `${order.source}:${text}` : "";
}

function samePendingSignature(stored, current) {
  if (!stored || !current) return false;
  if (stored === current) return true;
  return current.startsWith("cart:") && stored === current.slice(5);
}

export function rememberPendingOrder(order) {
  const signature = order && order.signature ? order.signature : pendingSignature(order);
  const stored = { ...order, signature };
  const list = readPendingOrders().filter((item) => item.requestId !== stored.requestId);
  list.unshift(stored);
  localStorage.setItem(TAMSUN_PENDING_ORDERS, JSON.stringify(list.slice(0, 20)));
}

export function findPendingOrder(order) {
  const signature = order && order.signature ? order.signature : pendingSignature(order);
  if (!signature) return null;
  return (
    readPendingOrders().find(
      (item) => item && item.requestId && item.source === order.source && samePendingSignature(item.signature, signature)
    ) || null
  );
}

function withContact(message, name, phone) {
  let text = String(message || "").trim();
  const put = (label, value) => {
    const line = `${label}: ${value}`;
    const pattern = new RegExp(`^${label}:.*$`, "m");
    if (pattern.test(text)) text = text.replace(pattern, () => line);
    else text = text ? `${text}\n${line}` : line;
  };
  if (name) put("Имя", name);
  if (phone) put("Телефон", phone);
  return text;
}

export function buildServerOrderMessage(data, order) {
  const items = flatOrderItems(data && data.items).filter((item) => item && String(item.name || item.id || "").trim());
  const saved = String((data && data.message) || (order && order.message) || "");
  const name = String((order && order.customerName) || "").trim();
  const phone = String((order && order.customerPhone) || "").trim();
  if (!items.length) return withContact(saved, name, phone).slice(0, 1500);
  const currency = data && data.currency === "usd" ? "usd" : order && order.currency === "usd" ? "usd" : "kzt";
  const usdRate = Number(data && data.usdRate) > 0 ? Number(data.usdRate) : getUsdRate();
  const total = Number(data && data.totalKzt) || items.reduce((sum, item) => sum + (Number(item.lineTotalKzt) || 0), 0);
  let body = "";
  if ((order && order.source === "cart") || items.length > 1) {
    const lines = items.map(
      (item, index) =>
        `${index + 1}. ${item.name} × ${Number(item.qty) || 1} — ${formatMoney(item.lineTotalKzt, currency, usdRate)}`
    );
    body = [
      "Здравствуйте! Хочу оформить заказ в Tamsun.",
      "",
      "Корзина:",
      ...lines,
      "",
      `Итого: ${formatMoney(total, currency, usdRate)}`,
    ].join("\n");
  } else if (order && order.source === "chat") {
    const item = items[0];
    const qty = Number(item.qty) > 1 ? ` × ${Number(item.qty)}` : "";
    body = `Здравствуйте! Интересует «${item.name}»${qty} — ${formatMoney(item.lineTotalKzt, currency, usdRate)}.`;
  } else {
    const item = items[0];
    body = [
      "Здравствуйте! Хочу оформить заказ в Tamsun.",
      `Товар: ${item.name}`,
      item.label ? `Линия: ${item.label}` : "",
      `Цена: ${formatMoney(item.lineTotalKzt, currency, usdRate)}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const contact = [`Имя: ${name}`, `Телефон: ${phone}`].filter((line) => !line.endsWith(": ")).join("\n");
  return [body, contact].filter(Boolean).join("\n\n").slice(0, 1500);
}

export async function settleSavedOrder(order, data, releaseCart) {
  const message = buildServerOrderMessage(data, order);
  let savedMessage = message || String((data && data.message) || (order && order.message) || "");
  if (message && message !== String((data && data.message) || "")) {
    const next = { ...order, message, syncMessage: true };
    try {
      const response = await apiFetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (response.ok) {
        const saved = await response.json().catch(() => ({}));
        savedMessage = String(saved.message || message);
        forgetPendingOrder(order.requestId);
      } else if (response.status === 400 || response.status === 409) {
        forgetPendingOrder(order.requestId);
      } else {
        rememberPendingOrder(next);
      }
    } catch (error) {
      console.error("order_sync_failed");
      rememberPendingOrder(next);
    }
  } else {
    forgetPendingOrder(order.requestId);
  }
  if (releaseCart && order && order.source === "cart") {
    const priced = flatOrderItems(data && data.items).filter((item) => item && item.id);
    if (priced.length) releaseCartAfterOrder(priced);
  }
  return savedMessage;
}

export function forgetPendingOrder(requestId) {
  const list = readPendingOrders().filter((item) => item.requestId !== requestId);
  localStorage.setItem(TAMSUN_PENDING_ORDERS, JSON.stringify(list));
}

export async function flushPendingOrders() {
  const list = readPendingOrders();
  for (const order of list) {
    try {
      const response = await apiFetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(order),
      });
      if (response.status === 400 || response.status === 409) {
        forgetPendingOrder(order.requestId);
        continue;
      }
      if (!response.ok) {
        console.error("pending_order_failed", response.status);
        continue;
      }
      const data = await response.json().catch(() => ({}));
      if (data.status === "cancelled") {
        forgetPendingOrder(order.requestId);
        continue;
      }
      const current = order.source === "cart" ? pendingSignature({ source: "cart" }) : "";
      const sameCart = order.source === "cart" && samePendingSignature(order.signature, current);
      await settleSavedOrder(order, data, sameCart);
    } catch (error) {
      console.error("pending_order_failed", "network");
    }
  }
}

export function readFileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      const data = raw.includes(",") ? raw.split(",")[1] : raw;
      resolve({
        name: file.name || "file",
        type: file.type || "application/octet-stream",
        data,
      });
    };
    reader.onerror = () => reject(reader.error || new Error("file"));
    reader.readAsDataURL(file);
  });
}

export function resizeImageFile(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const name = String(file.name || "image").replace(/\.[^.]+$/, "") + ".jpg";
          resolve(new File([blob], name, { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export async function uploadImageFile(file) {
  const ready = await resizeImageFile(file);
  const payload = await readFileData(ready);
  const response = await apiFetch("/api/upload", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ data: payload.data, type: ready.type || "image/jpeg" }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error("unauthorized");
  if (!response.ok || !body.path) throw new Error(body.error || "upload");
  return body.path;
}
