import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readApiKey() {
  const fromEnv = String(process.env.OPENAI_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (fromEnv) return fromEnv;
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  let found = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = trimmed.match(/^OPENAI_API_KEY\s*=\s*(.+)$/);
    if (match) found = match[1].trim().replace(/^["']|["']$/g, "");
    else if (/^sk-/.test(trimmed)) found = trimmed;
  }
  return found || null;
}

export async function completeChat(key, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error("openai_http_" + response.status);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
