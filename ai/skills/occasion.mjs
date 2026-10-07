import { whatsappLink } from "../../src/lib/store.js";
import { finish, rankProducts } from "../context.mjs";
import { servicesReply } from "./service.mjs";

function isOccasion(query) {
  return /подар|гост|юбил|дипломат|посол|визит|корпорат|партнер|событ|повод|вруч/.test(query);
}

function occasionReply(query, products, services) {
  if (/кубок|наград|турнир|чемпионат/.test(query)) {
    const service = services.find((item) => /куб|наград/i.test(item.title));
    return servicesReply(service ? [service] : services, query);
  }

  const bonus = new Map();
  if (/юбил|партнер|процвет|бизнес|сделк/.test(query)) bonus.set("jeti-qazyna", 8);
  if (/посол|послу|посла|послов|дипломат|визит|официальн|протокол/.test(query)) bonus.set("bes-qaru", 8);
  if (/культур|степ|традиц|памят|казах/.test(query)) {
    bonus.set("dala-uni", 8);
    bonus.set("bes-qaru", (bonus.get("bes-qaru") || 0) + 4);
  }
  const ranked = products
    .map((product) => {
      const found = rankProducts(query, [product])[0];
      return { product, score: (found ? found.score : 0) + (bonus.get(product.id) || 0) };
    })
    .sort((a, b) => b.score - a.score);
  const picks = ranked.filter((item) => item.score > 0).map((item) => item.product);
  const list = (picks.length ? picks : products).slice(0, 3);
  const custom = services.find((item) => item.id === "gifts") || services[0];
  const intro =
    list.length === 1
      ? `Для такого жеста я бы взял ${list[0].name}. ${list[0].description}`
      : "Для такого жеста я бы начал с этих изделий: у каждого уже есть история.";

  return finish({
    topic: "occasion",
    productIds: list.map((item) => item.id),
    products: list,
    text: custom
      ? `${intro} Если нужен личный символ, а не готовая форма — ${custom.title.toLowerCase()}: ${custom.description}`
      : `${intro} Если нужна своя форма, соберём её под заказ.`,
    chips: ["Цена и размер", "Изделие под заказ", "Оформить в WhatsApp"],
    actions: [
      {
        label: "Обсудить повод в WhatsApp",
        href: whatsappLink("Здравствуйте! Помогите подобрать подарок Tamsun под повод."),
        external: true,
      },
    ],
  });
}

export const skill = {
  id: "occasion",
  priority: 80,
  prompt: "Include only facts already said: product, occasion, quantity, budget. Do not invent details.",
  match(ctx) {
    return isOccasion(ctx.query);
  },
  reply(ctx) {
    return occasionReply(ctx.query, ctx.products, ctx.services);
  },
};
