import { formatPrice, getProductPriceKzt } from "../../src/lib/store.js";
import { finish } from "../context.mjs";

function isBudget(query) {
  return /бюджет|до \d|не дороже|недорог|дешевл|подешев|премиум|самый дорог/.test(query);
}

function isCheaper(query) {
  return query === "дешевле" || /что дешевле|самый дешев/.test(query);
}

function budgetReply(query, products) {
  const sorted = [...products].sort((a, b) => getProductPriceKzt(a) - getProductPriceKzt(b));
  const numbers = (query.match(/\d[\d ]{2,}/g) || []).map((item) => Number(item.replace(/\s/g, ""))).filter((item) => item >= 1000);
  let pool = sorted;
  if (numbers.length) {
    const limit = numbers[0];
    const under = sorted.filter((item) => getProductPriceKzt(item) <= limit);
    pool = under.length ? under : sorted.slice(0, 1);
  } else if (/дороже|премиум/.test(query)) {
    pool = sorted.slice().reverse();
  }
  const picks = pool.slice(0, 3);
  return finish({
    topic: "budget",
    productIds: picks.map((item) => item.id),
    products: picks,
    text: numbers.length
      ? `В бюджет около ${formatPrice(numbers[0])} смотрите эти позиции. Если нужен тираж или свой символ, это уже услуга под заказ.`
      : "По цене в каталоге так. Напишите потолок бюджета, если нужно сузить.",
    chips: ["Изделие под заказ", "Что подарить гостю"],
  });
}

export const skill = {
  id: "budget",
  priority: 90,
  prompt: "Leave handoff empty while the visitor is only asking about price or budget. Do not invent discounts. Use only catalog prices.",
  match(ctx) {
    return isBudget(ctx.query) || isCheaper(ctx.query);
  },
  reply(ctx) {
    if (isBudget(ctx.query)) return budgetReply(ctx.query, ctx.products);
    return budgetReply("дешевле", ctx.products);
  },
};
