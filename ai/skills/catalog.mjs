import { finish, plural } from "../context.mjs";

function isCatalog(query) {
  return /каталог|ассортимент|что есть|какие товар|что у вас|покаж|все товар|список/.test(query);
}

function catalogReply(products) {
  if (!products.length) {
    return finish({
      topic: "catalog",
      text: "Каталог сейчас пуст. Можем собрать изделие под заказ: сувенир, кубок или персональный подарок.",
      chips: ["Изделие под заказ", "Как оформить заказ"],
    });
  }
  return finish({
    topic: "catalog",
    productIds: products.map((item) => item.id),
    products: products.slice(0, 6),
    text: `В магазине ${products.length} ${plural(products.length, "изделие", "изделия", "изделий")}. Все позиции можно заказать сразу или взять как основу для своего варианта.`,
    chips: ["Что подарить гостю", "Сравнить цены", "Изделие под заказ"],
  });
}

export const exactSkill = {
  id: "catalog-more",
  priority: 200,
  prompt: "",
  match(ctx) {
    return /^что ещё есть$|^что еще есть$/.test(ctx.query);
  },
  reply(ctx) {
    return catalogReply(ctx.products);
  },
};

export const skill = {
  id: "catalog",
  priority: 40,
  prompt: "Use only products and services from the catalog. Do not invent extra products.",
  match(ctx) {
    return isCatalog(ctx.query);
  },
  reply(ctx) {
    return catalogReply(ctx.products);
  },
};
