import { buildHandoffDraft, finish, handoffAction, visibleProducts } from "../context.mjs";

function isOrder(query) {
  return /как заказ|оформ|купить|доставк|срок|оплат/.test(query);
}

function orderReply(products, session) {
  const draft = buildHandoffDraft(
    {
      messages: session.messages || [],
      lastProductIds: products.length ? products.map((item) => item.id) : session.lastProductIds || [],
    },
    products.length ? products : visibleProducts()
  );
  const name = products[0] ? `«${products[0].name}»` : "заказ";
  return finish({
    topic: "order",
    productIds: products.map((item) => item.id),
    handoff: draft,
    text: `По ${name} дальше лучше написать в WhatsApp: там подтвердят изделие, срок и оплату. Сообщение уже собрано, его можно поправить перед отправкой.`,
    chips: ["Что есть в каталоге", "Изделие под заказ"],
    actions: handoffAction(draft),
  });
}

export const skill = {
  id: "order",
  priority: 60,
  prompt:
    "Set handoff when the visitor wants to order, buy, reserve, pay, or get a custom item; asks about lead time, delivery, engraving, changes, a discount, a meeting, or a call; or has chosen a product and asks what to do next. The handoff is the visitor's own message, in Russian, first person, under 400 characters.",
  match(ctx) {
    return isOrder(ctx.query);
  },
  reply(ctx) {
    return orderReply(ctx.focused, ctx.session);
  },
};
