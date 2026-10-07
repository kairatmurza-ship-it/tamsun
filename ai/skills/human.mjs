import { buildHandoffDraft, finish, handoffAction, visibleProducts } from "../context.mjs";

function isHuman(query) {
  return /менеджер|оператор|человек|живой|whatsapp|ватсап|вотсап|позвон|созвон|связ|перезвон/.test(query);
}

export const skill = {
  id: "human",
  priority: 150,
  prompt:
    "Set handoff when the visitor asks for a person, a manager, WhatsApp, or a phone number. When handoff is not empty, point to the button and do not say the message was already sent.",
  match(ctx) {
    return isHuman(ctx.query);
  },
  reply(ctx) {
    const draft = buildHandoffDraft(ctx.session, visibleProducts());
    return finish({
      topic: "human",
      handoff: draft,
      text: "Дальше удобнее написать напрямую в WhatsApp: там уже живой разговор, подтверждают изделие, срок и оплату. Текст ниже собран из нашего разговора, его можно поправить перед отправкой.",
      chips: ["Что есть в каталоге", "Изделие под заказ"],
      actions: handoffAction(draft),
    });
  },
};
