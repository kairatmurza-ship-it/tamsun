import { defaultChips, finish } from "../context.mjs";

export const skill = {
  id: "fallback",
  priority: 0,
  prompt: "Do not invent delivery times, discounts, or extra products. chips: up to 3 short Russian phrases the visitor might ask next.",
  match() {
    return true;
  },
  reply(ctx) {
    const products = ctx.products;
    return finish({
      topic: "fallback",
      text: "Уточните, пожалуйста: готовое изделие из каталога, подарок к конкретному поводу или разработка под заказ. Могу оттолкнуться от бюджета, материала или того, кому вручаете.",
      products: products.slice(0, 3),
      productIds: products.slice(0, 3).map((item) => item.id),
      chips: defaultChips(),
    });
  },
};
