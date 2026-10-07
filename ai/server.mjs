import { prepareAttachments } from "./attachments.mjs";
import { completeChat, readApiKey } from "./openai.mjs";
import { buildSystemPrompt } from "./prompt.mjs";
import { skills } from "./skills/index.mjs";

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function formatCatalogPrice(priceKzt, currency, usdRate) {
  const value = Number(priceKzt) || 0;
  if (currency === "usd") {
    const rate = Number(usdRate) > 0 ? Number(usdRate) : 500;
    const shown = value / rate;
    const text = shown.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    return text + " $";
  }
  return Math.round(value).toLocaleString("ru-RU") + " ₸";
}

function catalogProduct(item, currency, usdRate) {
  if (!item || item.id == null || item.priceKzt == null || item.priceKzt === "") return null;
  const name = String(item.name || "").trim();
  if (!name) return null;
  return {
    id: String(item.id),
    name: name.slice(0, 160),
    description: String(item.description || "").slice(0, 400),
    price: formatCatalogPrice(item.priceKzt, currency, usdRate),
    size: String(item.size || "").slice(0, 80),
    material: String(item.material || "").slice(0, 80),
    origin: String(item.origin || "").slice(0, 80),
  };
}

function normalizeCatalog(payload) {
  const currency = payload && payload.currency === "usd" ? "usd" : "kzt";
  const usdRate = Number(payload && payload.usdRate) > 0 ? Number(payload.usdRate) : 500;
  const products = [];
  for (const item of asArray(payload && payload.products)) {
    if (products.length >= 40) break;
    const product = catalogProduct(item, currency, usdRate);
    if (product) products.push(product);
  }
  const services = [];
  for (const item of asArray(payload && payload.services)) {
    if (!item) continue;
    const title = String(item.title || "").trim();
    if (!title) continue;
    services.push({
      title: title.slice(0, 160),
      description: String(item.description || "").slice(0, 400),
    });
    if (services.length >= 12) break;
  }
  return { products, services, currency, usdRate };
}

function focusNote(ids, products) {
  const lines = [];
  for (const id of asArray(ids)) {
    const product = products.find((item) => item.id === String(id));
    if (!product || lines.length >= 3) continue;
    lines.push(product.name + " (" + product.id + ") — " + product.price);
  }
  if (!lines.length) return "";
  return "The visitor is looking at: " + lines.join("; ") + ". Treat words like этот as these products unless the visitor names another one.";
}

function shownNote(ids, products) {
  const lines = [];
  for (const id of asArray(ids)) {
    const product = products.find((item) => item.id === String(id));
    if (!product || lines.length >= 3) continue;
    lines.push(product.name + " — " + product.price);
  }
  if (!lines.length) return "";
  return "Shown cards: " + lines.join("; ") + ".";
}

function buildMessages(payload, prepared, products) {
  let messageList = asArray(payload.messages);
  if (messageList.length > 12) messageList = messageList.slice(-12);
  let lastUser = -1;
  for (let i = 0; i < messageList.length; i++) {
    if (String(messageList[i].role) !== "assistant") lastUser = i;
  }

  const oaMessages = [];
  let count = 0;
  for (let i = 0; i < messageList.length; i++) {
    if (count >= 12) break;
    const item = messageList[i];
    let content = String(item.content || "");
    if (content.length > 2000) content = content.slice(0, 2000);
    const role = String(item.role) === "assistant" ? "assistant" : "user";
    if (role === "assistant") {
      const note = shownNote(item.productIds, products);
      if (note) content = (content + "\n" + note).trim();
    }
    if (i === lastUser && prepared.length > 0) {
      const notes = [];
      const media = [];
      for (const part of prepared) {
        if (String(part.kind) === "text") notes.push(String(part.text));
        else if (part.body) media.push(part.body);
      }
      if (notes.length) content = (content + "\n\n" + notes.join("\n\n")).trim();
      if (content.length > 10000) content = content.slice(0, 10000);
      if (media.length) {
        if (!content.trim()) content = "Look at the attachment.";
        oaMessages.push({
          role: "user",
          content: [{ type: "text", text: content }, ...media],
        });
        count++;
        continue;
      }
    }
    if (!content.trim()) continue;
    oaMessages.push({ role, content });
    count++;
  }
  return oaMessages;
}

export async function consultRemote(payload) {
  const key = readApiKey();
  if (!key) return { status: 500, body: { error: "unavailable" } };

  const catalog = normalizeCatalog(payload);
  const products = catalog.products;
  const services = catalog.services;
  const catalogJson = JSON.stringify({
    products: products.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      size: item.size,
      material: item.material,
      origin: item.origin,
    })),
    services,
  });
  const system = buildSystemPrompt(catalogJson, skills, focusNote(payload && payload.focusIds, products));
  const prepared = prepareAttachments(payload || {});
  const oaMessages = [{ role: "system", content: system }, ...buildMessages(payload || {}, prepared, products)];
  if (oaMessages.length < 2) return { status: 502, body: { error: "unavailable" } };

  let result;
  try {
    result = await completeChat(key, {
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: oaMessages,
    });
  } catch (error) {
    const detail = String(error && error.message ? error.message : error).slice(0, 300);
    console.error("openai_error " + detail);
    return { status: 502, body: { error: "unavailable" } };
  }

  const content = result && result.choices && result.choices[0] && result.choices[0].message
    ? result.choices[0].message.content
    : null;
  if (content == null) return { status: 502, body: { error: "unavailable" } };

  let parsed;
  try {
    parsed = JSON.parse(String(content));
  } catch (error) {
    console.error("openai_bad_json");
    return { status: 502, body: { error: "unavailable" } };
  }

  const allowed = new Set(products.map((product) => String(product.id)));
  const ids = [];
  for (const id of asArray(parsed.productIds)) {
    if (allowed.has(String(id))) ids.push(String(id));
  }
  const chips = [];
  for (const chip of asArray(parsed.chips)) {
    const text = String(chip || "").trim();
    if (!text || chips.length >= 3) continue;
    chips.push(text.slice(0, 40));
  }

  let handoff = "";
  if (parsed.handoff) {
    handoff = String(parsed.handoff).replace(/\s+/g, " ").trim();
    if (handoff.length > 40) handoff = "order";
  }

  let text = String(parsed.text || "").trim();
  if (!text && ids.length) text = "Вот что подходит из каталога.";
  if (!text) return { status: 502, body: { error: "unavailable" } };

  return {
    status: 200,
    body: {
      text,
      productIds: ids,
      chips,
      handoff,
    },
  };
}
