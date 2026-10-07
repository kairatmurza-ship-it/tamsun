import { finish } from "../context.mjs";

function isAbout(query) {
  return /кто вы|о компан|о вас|tamsun|тамсун|что такое|полный цикл|производств/.test(query);
}

export const skill = {
  id: "about",
  priority: 50,
  prompt: "You are the consultant of Tamsun Group, a premium souvenir workshop in Astana. The visitor talks to you first.",
  match(ctx) {
    return isAbout(ctx.query);
  },
  reply() {
    return finish({
      topic: "about",
      text: "Tamsun Group — премиальные сувениры полного цикла в Астане. Эскиз, материал, сборка и упаковка остаются внутри мастерской, без чужих каталогов. Делаем и готовые изделия с историей, и штучные подарки для визитов, юбилеев и наград.",
      chips: ["Что есть в каталоге", "Изделие под заказ", "Контакты"],
    });
  },
};
