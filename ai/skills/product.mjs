import { formatPrice, getProductPriceKzt } from "../../src/lib/store.js";
import { finish, orderActions } from "../context.mjs";

function describeReply(products, query) {
  const lead =
    products.length === 1 ? `Ближе всего «${products[0].name}». ${products[0].description}` : "Вот что подходит из каталога:";
  const extra = /цен|стоим|сколько/.test(query)
    ? "\n\n" + products.map((item) => `${item.name} — ${formatPrice(getProductPriceKzt(item))}.`).join(" ")
    : "";
  return finish({
    topic: "product",
    productIds: products.map((item) => item.id),
    products,
    text: lead + extra,
    chips: ["Цена и размер", "В корзину", "Что подарить гостю"],
    actions: orderActions(products[0]),
  });
}

export const strongSkill = {
  id: "product",
  priority: 100,
  prompt: "Use only products from the catalog. productIds: up to 3 ids to show as cards, or an empty array.",
  match(ctx) {
    return ctx.strong.length > 0;
  },
  reply(ctx) {
    return describeReply(
      ctx.strong.slice(0, 3).map((item) => item.product),
      ctx.query
    );
  },
};

export const weakSkill = {
  id: "product-weak",
  priority: 30,
  prompt: "",
  match(ctx) {
    return ctx.ranked.length > 0 && ctx.ranked[0].score >= 2;
  },
  reply(ctx) {
    return describeReply(
      ctx.ranked.slice(0, 2).map((item) => item.product),
      ctx.query
    );
  },
};
