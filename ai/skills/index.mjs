import { skill as about } from "./about.mjs";
import { skill as budget } from "./budget.mjs";
import { addSkill as cartAdd, skill as cart } from "./cart.mjs";
import { exactSkill as catalogMore, skill as catalog } from "./catalog.mjs";
import { exactSkill as compareExact, skill as compare } from "./compare.mjs";
import { exactSkill as contactExact, skill as contact } from "./contact.mjs";
import { skill as facts } from "./facts.mjs";
import { skill as fallback } from "./fallback.mjs";
import { skill as greeting } from "./greeting.mjs";
import { skill as human } from "./human.mjs";
import { skill as occasion } from "./occasion.mjs";
import { skill as order } from "./order.mjs";
import { strongSkill as product, weakSkill as productWeak } from "./product.mjs";
import { skill as service } from "./service.mjs";
import { skill as thanks } from "./thanks.mjs";

export const skills = [
  compareExact,
  catalogMore,
  contactExact,
  cartAdd,
  greeting,
  thanks,
  human,
  cart,
  contact,
  facts,
  compare,
  product,
  budget,
  occasion,
  service,
  order,
  about,
  catalog,
  productWeak,
  fallback,
].sort((a, b) => b.priority - a.priority);
