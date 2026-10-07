import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const media = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp4", ".webm", ".ico"]);

function attachRootMedia(server) {
  server.middlewares.use((req, res, next) => {
    const raw = decodeURIComponent((req.url || "").split("?")[0]);
    const ext = path.extname(raw).toLowerCase();
    if (!media.has(ext) || raw.includes("..")) return next();
    const root = path.resolve(server.config.root);
    const file = path.resolve(root, "." + raw);
    const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
    const rel = path.relative(root, file);
    const hidden = rel.split(path.sep).some((seg) => /^(node_modules|data|src)$/i.test(seg));
    if (hidden || !file.startsWith(rootPrefix) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
    res.setHeader("Content-Type", mediaType(ext));
    fs.createReadStream(file).pipe(res);
  });
}

function serveRootMedia() {
  return {
    name: "tamsun-root-media",
    configureServer: attachRootMedia,
    configurePreviewServer: attachRootMedia,
  };
}

function mediaType(ext) {
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  return "image/jpeg";
}

export default defineConfig({
  plugins: [react(), serveRootMedia()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/uploads": "http://127.0.0.1:8765",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
