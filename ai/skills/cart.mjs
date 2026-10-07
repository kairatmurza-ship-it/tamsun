import { buildCartWhatsAppLink, formatPrice, getCartCount, getCartTotalKzt, addToCart } from "../../src/lib/store.js";
import { finish, plural } from "../context.mjs";

function wantsAddToCart(query) {
  return /корзин/.test(query) && /добав|положи|бери|возьм/.test(query);
}

function isCartQuery(query) {
  return /корзин/.test(query) && !/добав|положи/.test(query);
}

function cartReply() {
  const count = getCartCount();
  const total = formatPrice(getCartTotalKzt());
  if (!count) {
    return finish({
      topic: "cart",
      text: "Корзина пустая. Могу подобрать изделие и сразу положить его туда.",
      chips: ["Что есть в каталоге", "Что подарить гостю"],
    });
  }
  return finish({
    topic: "cart",
    text: `В корзине ${count} ${plural(count, "позиция", "позиции", "позиций")} на ${total}.`,
    chips: ["Что ещё есть", "Как оформить заказ"],
    actions: [
      {
        label: "Отправить заказ",
        href: buildCartWhatsAppLink(),
        external: true,
        orderSource: "cart",
      },
    ],
  });
}

export const addSkill = {
  id: "cart-add",
  priority: 180,
  prompt: "",
  match(ctx) {
    return wantsAddToCart(ctx.query) || ctx.query === "в корзину";
  },
  reply(ctx) {
    const cartTarget = ctx.focused[0] || ctx.remembered[0];
    if (!cartTarget) {
      return finish({
        topic: "cart",
        text: "Сначала выберите изделие из каталога, и я положу его в корзину.",
        chips: ["Что есть в каталоге", "Что подарить гостю"],
      });
    }
    const result = addToCart(cartTarget.id, 1);
    const placed = result === "added";
    return finish({
      topic: "cart",
      productIds: [cartTarget.id],
      products: [cartTarget],
      text: placed
        ? `Положил в корзину: ${cartTarget.name}. Можно добавить ещё или сразу отправить заказ менеджеру.`
        : `${cartTarget.name} уже в корзине. Количество можно изменить в корзине.`,
      actions: [
        {
          label: "Оформить корзину в WhatsApp",
          href: buildCartWhatsAppLink(),
          external: true,
          orderSource: "cart",
        },
      ],
      chips: ["Что ещё есть", "Как оформить заказ"],
    });
  },
};

export const skill = {
  id: "cart",
  priority: 140,
  prompt: "Leave handoff empty while the visitor is only browsing.",
  match(ctx) {
    return isCartQuery(ctx.query);
  },
  reply() {
    return cartReply();
  },
};
