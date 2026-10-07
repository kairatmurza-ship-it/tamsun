import { buildContext } from "./context.mjs";
import { skills } from "./skills/index.mjs";

export function consult(raw, session) {
  const ctx = buildContext(raw, session);
  for (const skill of skills) {
    if (skill.match(ctx)) return skill.reply(ctx);
  }
  return skills[skills.length - 1].reply(ctx);
}

export { greetingReply } from "./skills/greeting.mjs";
