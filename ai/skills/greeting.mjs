import { defaultChips } from "../context.mjs";

export function greetingReply() {
  return {
    role: "in",
    topic: "hello",
    text: "Здравствуйте. Я консультант Tamsun. Помогу выбрать сувенир из каталога или собрать идею под заказ: визит, юбилей, награда или личный жест.",
    chips: defaultChips(),
  };
}

function isGreeting(query) {
  return /^(привет|здравств|добрый|доброе|hello|hi|салам|ассалаума|ассалаумагалейкум)\b/.test(query) && query.split(" ").length <= 6;
}

export const skill = {
  id: "greeting",
  priority: 170,
  prompt: "While the visitor is only saying hello, leave handoff empty.",
  match(ctx) {
    return isGreeting(ctx.query);
  },
  reply() {
    return greetingReply();
  },
};
