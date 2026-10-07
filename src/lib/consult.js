import { apiFetch, getCurrency, readFileData, resizeImageFile } from "./store.js";
import {
  defaultChips,
  finish,
  handoffAction,
  isCartRequest,
  resolveHandoff,
  visibleProducts,
} from "../../ai/context.mjs";
import { consult, greetingReply } from "../../ai/local.mjs";

export const TAMSUN_CHAT_SESSION = "tamsun_chat_session_v1";

export { consult, greetingReply, defaultChips, handoffAction, isCartRequest, visibleProducts };

export function loadSession() {
  try {
    const raw = sessionStorage.getItem(TAMSUN_CHAT_SESSION);
    if (!raw) return { messages: [], lastProductIds: [], lastTopic: "" };
    const parsed = JSON.parse(raw);
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      lastProductIds: Array.isArray(parsed.lastProductIds) ? parsed.lastProductIds : [],
      lastTopic: parsed.lastTopic || "",
    };
  } catch (error) {
    return { messages: [], lastProductIds: [], lastTopic: "" };
  }
}

export function saveSession(session) {
  const write = (value) => sessionStorage.setItem(TAMSUN_CHAT_SESSION, JSON.stringify(value));
  try {
    write(session);
  } catch (error) {
    if (session && Array.isArray(session.messages) && session.messages.length > 4) {
      session.messages = session.messages.slice(-4);
      try {
        write(session);
      } catch (again) {
        console.error("chat_session_failed");
      }
    }
  }
}

export function fileToAttachment(file) {
  const resizable = /^image\/(jpeg|png|gif|webp)$/i.test(String(file.type || ""));
  const prepare = resizable ? resizeImageFile(file) : Promise.resolve(file);
  return prepare.then((ready) => readFileData(ready));
}

export function requestAiReply(session, attachments, signal) {
  const products = visibleProducts();
  const files = (attachments || []).slice(0, 4).map((file) => ({
    name: file.name,
    type: file.type,
    data: file.data,
  }));
  const payload = {
    messages: session.messages.slice(-12).map((item) => ({
      role: item.role === "out" ? "user" : "assistant",
      content: String(item.text || "").slice(0, 2000),
      productIds: Array.isArray(item.productIds) ? item.productIds.slice(0, 3) : [],
    })),
    attachments: files,
    currency: getCurrency() === "usd" ? "usd" : "kzt",
    focusIds: (session.lastProductIds || []).slice(0, 3),
  };
  const packed = files.reduce((sum, file) => sum + String(file.data || "").length, 0);
  if (packed > 9000000) return Promise.reject(new Error("too_large"));

  return apiFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
    timeout: 35000,
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.text) throw new Error(data.error || "api");
    const ids = [].concat(data.productIds || []).filter(Boolean);
    const shown = products.filter((item) => ids.includes(item.id)).slice(0, 3);
    const chips = [].concat(data.chips || []).filter((item) => item && !/whatsapp|ватсап|вотсап/i.test(item));
    const handoff = resolveHandoff(data.handoff, session, products, shown);
    let text = String(data.text);
    if (handoff && !/whatsapp|ватсап|вотсап/i.test(text)) {
      text =
        text.replace(/\s+$/, "") +
        "\n\nКнопка ниже откроет WhatsApp. Сообщение уже написано, его можно поправить перед отправкой. Там подтвердят изделие, срок и оплату.";
    }
    return finish({
      topic: handoff ? "human" : "ai",
      text,
      productIds: shown.map((item) => item.id),
      products: shown,
      chips: chips.length ? chips.slice(0, 3) : handoff ? ["Что есть в каталоге", "Изделие под заказ"] : defaultChips(),
      handoff,
      actions: handoffAction(handoff),
    });
  });
}
