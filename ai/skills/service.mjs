import { whatsappLink } from "../../src/lib/store.js";
import { finish, fold, visibleServices } from "../context.mjs";

export function servicesReply(services, query) {
  const list = services.length ? services : visibleServices();
  const focused = list.filter((item) => {
    const hay = fold(item.title + " " + item.description);
    if (/кубок|наград/.test(query)) return /куб|наград/.test(hay);
    if (/сувенир|корпорат|бренд/.test(query)) return /сувенир|символ/.test(hay);
    if (/личн|персонал|индивид|посол/.test(query)) return /индивид|персонал|подар/.test(hay);
    return true;
  });
  const shown = (focused.length ? focused : list).slice(0, 3);
  const text = shown.length
    ? "Под заказ работаем так:\n\n" +
      shown.map((item) => `${item.title}. ${item.description}`).join("\n\n") +
      "\n\nТираж может быть от одной штуки. Напишите повод и кому вручаете — предложу направление."
    : "Услуги под заказ скоро появятся в описании. Могу соединить вас с менеджером в WhatsApp.";
  return finish({
    topic: "service",
    text,
    chips: ["Что есть в каталоге", "Как оформить заказ"],
    actions: [
      {
        label: "Обсудить услугу",
        href: whatsappLink("Здравствуйте! Интересует услуга по разработке сувениров / кубков / индивидуальных подарков."),
        external: true,
      },
    ],
  });
}

function isService(query) {
  return /услуг|под заказ|на заказ|индивидуал|разработ|тираж|кубок|наград|статуэт|логотип/.test(query);
}

export const skill = {
  id: "service",
  priority: 70,
  prompt: "Set handoff when the visitor wants a custom item. Use only services from the catalog.",
  match(ctx) {
    return isService(ctx.query);
  },
  reply(ctx) {
    return servicesReply(ctx.services, ctx.query);
  },
};
