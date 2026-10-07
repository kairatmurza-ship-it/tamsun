import {
  formatPrice,
  getProductPriceKzt,
  loadProducts,
  loadServices,
  whatsappLink,
} from "../src/lib/store.js";

export const PRODUCT_ALIASES = {
  "bes-qaru": ["бес кару", "бес кару", "пять оруж", "воинск", "честь", "bes qaru"],
  "dala-uni": ["дала уни", "зов степи", "степ", "кочев", "dala uni", "инструмент"],
  "jeti-qazyna": ["жети казына", "семь сокровищ", "благополуч", "процвет", "jeti"],
};

const STOP = new Set(["что", "как", "это", "для", "или", "про", "мне", "есть", "хочу", "можно", "расскаж", "подскаж"]);

export function fold(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/ә/g, "а")
    .replace(/ғ/g, "г")
    .replace(/қ/g, "к")
    .replace(/ң/g, "н")
    .replace(/ө/g, "о")
    .replace(/ұ/g, "у")
    .replace(/ү/g, "у")
    .replace(/һ/g, "х")
    .replace(/і/g, "и")
    .replace(/[^a-zа-я0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function visibleProducts() {
  return loadProducts().filter((item) => item.visible !== false && item.name);
}

export function visibleServices() {
  return loadServices().filter((item) => item.visible !== false && item.title);
}

export function defaultChips() {
  return ["Что есть в каталоге", "Что подарить гостю", "Изделие под заказ", "Как оформить заказ"];
}

export function finish(reply) {
  return {
    role: "in",
    chips: reply.chips || defaultChips(),
    ...reply,
  };
}

export function handoffAction(draft) {
  const text = String(draft || "").trim();
  if (!text) return [];
  return [
    {
      label: "Написать в WhatsApp",
      href: whatsappLink(text),
      external: true,
      primary: true,
      orderSource: "whatsapp",
    },
  ];
}

export function orderActions(product) {
  if (!product) return [];
  return [
    {
      label: "Заказать в WhatsApp",
      href: whatsappLink(`Здравствуйте! Интересует «${product.name}» — ${formatPrice(getProductPriceKzt(product))}.`),
      external: true,
      orderSource: "chat",
      productId: product.id,
    },
  ];
}

function visitorNeedsPerson(query) {
  return /заказ|оформ|купить|куплю|купим|оплат|достав|срок|гравир|скидк|созвон|позвон|встрет|менеджер|оператор|whatsapp|ватсап|вотсап|номер|телефон|связ|тираж|под заказ|на заказ|индивидуал/.test(
    query
  );
}

export function isCartRequest(text) {
  return /корзин/.test(fold(text));
}

export function buildHandoffDraft(session, products) {
  const said = (session.messages || [])
    .filter((item) => item.role === "out")
    .slice(-3)
    .map((item) => String(item.text || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const names = (session.lastProductIds || [])
    .map((id) => (products || []).find((item) => item.id === id))
    .filter(Boolean)
    .map((item) => `${item.name} — ${formatPrice(getProductPriceKzt(item))}`);
  const bits = [];
  if (names.length) bits.push("Интересует: " + names.join(", "));
  if (said.length) bits.push(said.join(". "));
  return ("Здравствуйте! " + (bits.join(". ") || "Хочу обсудить заказ в Tamsun.")).slice(0, 400);
}

export function resolveHandoff(modelDraft, session, products, shown) {
  const wantsPerson = Boolean(String(modelDraft || "").trim());
  const last = session.messages.filter((item) => item.role === "out").slice(-1)[0];
  if (!wantsPerson && !visitorNeedsPerson(fold(last && last.text))) return "";
  const focus = shown && shown.length ? shown.map((item) => item.id) : session.lastProductIds;
  return buildHandoffDraft({ ...session, lastProductIds: focus || [] }, products);
}

export function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function isFactQuestion(query) {
  return /цен|стоим|сколько|размер|материал|из чего|описан|про что|истори/.test(query);
}

function isFollowUp(query) {
  return (
    /^(а )?(этот|эта|это|его|ее|её|него|нее|неё|тот|та|перв|втор|трет)/.test(query) ||
    /про него|про нее|про неё|этот вариант|это изделие/.test(query)
  );
}

export function resolveFocus(query, products, session, strong) {
  if (strong.length) return strong.map((item) => item.product);
  if (!isFollowUp(query) && !isFactQuestion(query)) return [];
  const ids = session.lastProductIds || [];
  return products.filter((item) => ids.includes(item.id));
}

export function rankProducts(query, products) {
  const tokens = query.split(" ").filter((token) => token.length > 2 && !STOP.has(token));
  return products
    .map((product) => {
      const hay = fold([product.name, product.label, product.description, product.material, product.size, product.origin].join(" "));
      const aliases = PRODUCT_ALIASES[product.id] || [];
      let score = 0;
      aliases.forEach((alias) => {
        if (query.includes(fold(alias))) score += 6;
      });
      if (query.includes(fold(product.name))) score += 8;
      if (product.label && query.includes(fold(product.label))) score += 6;
      tokens.forEach((token) => {
        if (hay.includes(token)) score += 2;
      });
      return { product, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function buildContext(raw, session) {
  const query = fold(raw);
  const products = visibleProducts();
  const services = visibleServices();
  const ranked = rankProducts(query, products);
  const strong = ranked.filter((item) => item.score >= 3);
  const safeSession = session || { messages: [], lastProductIds: [], lastTopic: "" };
  const remembered = products.filter((item) => (safeSession.lastProductIds || []).includes(item.id));
  const focused = resolveFocus(query, products, safeSession, strong);
  return { raw, query, session: safeSession, products, services, ranked, strong, remembered, focused };
}
