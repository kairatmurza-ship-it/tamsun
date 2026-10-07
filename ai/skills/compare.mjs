import { formatPrice, getProductPriceKzt } from "../../src/lib/store.js";
import { finish } from "../context.mjs";

function compareReply(products) {
  const lines = products.map((product) => {
    return `${product.name} — ${formatPrice(getProductPriceKzt(product))}. ${product.size || ""} ${product.description}`;
  });
  return finish({
    topic: "compare",
    productIds: products.map((item) => item.id),
    products,
    text: "Коротко по смыслу и цене:\n\n" + lines.join("\n\n"),
    chips: ["Что подарить гостю", "В корзину", "Изделие под заказ"],
  });
}

export const exactSkill = {
  id: "compare-exact",
  priority: 210,
  prompt: "",
  match(ctx) {
    return /^сравнить цены$|^сравнить с другими$/.test(ctx.query);
  },
  reply(ctx) {
    const pool = ctx.remembered.length > 1 ? ctx.remembered : ctx.products.slice(0, 3);
    return compareReply(pool);
  },
};

export const skill = {
  id: "compare",
  priority: 110,
  prompt: "Leave handoff empty while the visitor is comparing products. productIds: up to 3 ids.",
  match(ctx) {
    return ctx.strong.length >= 2 && /сравн|отлич|разниц|или/.test(ctx.query);
  },
  reply(ctx) {
    return compareReply(ctx.strong.slice(0, 3).map((item) => item.product));
  },
};
