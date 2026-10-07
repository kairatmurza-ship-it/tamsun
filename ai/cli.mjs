import { consultRemote } from "./server.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8");

let payload;
try {
  payload = JSON.parse(raw);
} catch (error) {
  process.stdout.write("500\n" + JSON.stringify({ error: "unavailable" }));
  process.exit(0);
}

try {
  const reply = await consultRemote(payload);
  process.stdout.write(String(reply.status) + "\n" + JSON.stringify(reply.body));
} catch (error) {
  const detail = String(error && error.message ? error.message : error).slice(0, 300);
  console.error("openai_error " + detail);
  process.stdout.write("502\n" + JSON.stringify({ error: "unavailable" }));
}
