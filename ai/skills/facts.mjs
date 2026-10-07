import { formatPrice, getProductPriceKzt } from "../../src/lib/store.js";
import { finish, isFactQuestion, orderActions } from "../context.mjs";

function factLine(product, query) {
  const price = formatPrice(getProductPriceKzt(product));
  if (/размер/.test(query)) {
    return `${product.name}: ${product.size || "размер уточним у менеджера"}. Цена ${price}.`;
  }
  if (/материал|из чего/.test(query)) {
    return `${product.name}. Материал: ${product.material || "уточним под задачу"}. ${product.origin || ""}`.trim();
  }
  if (/истори|про что|описан|смысл|символ/.test(query)) {
    return `${product.name}. ${product.description}`;
  }
  return `${product.name} — ${price}. ${product.size ? "Размер " + product.size + ". " : ""}${product.material ? "Материал: " + product.material + "." : ""}`;
}

function factsReply(products, query) {
  const lines = products.map((product) => factLine(product, query));
  return finish({
    topic: "product",
    productIds: products.map((item) => item.id),
    products,
    text: lines.join("\n\n"),
    chips: ["Сравнить с другими", "В корзину", "Оформить в WhatsApp"],
    actions: orderActions(products[0]),
  });
}

export const skill = {
  id: "facts",
  priority: 120,
  prompt: "Use only prices, sizes, and materials from the catalog. Do not invent delivery times or discounts.",
  match(ctx) {
    return ctx.focused.length && isFactQuestion(ctx.query);
  },
  reply(ctx) {
    return factsReply(ctx.focused, ctx.query);
  },
};
