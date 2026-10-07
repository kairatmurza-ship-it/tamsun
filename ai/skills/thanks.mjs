import { defaultChips, finish } from "../context.mjs";

function isThanks(query) {
  return /^(спасибо|благодар|рахмет)\b/.test(query);
}

export const skill = {
  id: "thanks",
  priority: 160,
  prompt: "While the visitor is only thanking you, leave handoff empty.",
  match(ctx) {
    return isThanks(ctx.query);
  },
  reply() {
    return finish({
      topic: "hello",
      text: "Пожалуйста. Если появится повод или бюджет — напишите, подберу вариант.",
      chips: defaultChips(),
    });
  },
};
