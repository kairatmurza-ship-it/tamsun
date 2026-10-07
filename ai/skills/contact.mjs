import { buildHandoffDraft, finish, handoffAction, visibleProducts } from "../context.mjs";

function isContact(query) {
  return /контакт|телефон|номер|инстаграм|instagram|адрес|где вы|астана/.test(query);
}

function contactReply(session) {
  const draft = buildHandoffDraft(session || { messages: [], lastProductIds: [] }, visibleProducts());
  return finish({
    topic: "contact",
    handoff: draft,
    text: "Мы в Астане. Заказ, срок и оплату подтверждают в WhatsApp +7 701 227 15 05. Кнопка откроет чат с уже написанным сообщением. Instagram: @tamsun_astana.",
    chips: ["Как оформить заказ", "Что есть в каталоге"],
    actions: handoffAction(draft).concat([
      {
        label: "Instagram",
        href: "https://www.instagram.com/tamsun_astana/",
        external: true,
      },
    ]),
  });
}

export const exactSkill = {
  id: "contact-exact",
  priority: 190,
  prompt: "",
  match(ctx) {
    return /^контакты$/.test(ctx.query);
  },
  reply(ctx) {
    return contactReply(ctx.session);
  },
};

export const skill = {
  id: "contact",
  priority: 130,
  prompt:
    "Set handoff when the visitor asks for a phone number. Do not answer with only the phone number when handoff is not empty. Instagram: @tamsun_astana.",
  match(ctx) {
    return isContact(ctx.query);
  },
  reply(ctx) {
    return contactReply(ctx.session);
  },
};
