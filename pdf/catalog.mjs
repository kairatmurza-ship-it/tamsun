import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import PNG from "png-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const pageWidth = 1122.52;
const pageHeight = 793.7;
const dark = "#141210";
const watermark = "#2c2924";
const gold = "#c4a574";
const goldBright = "#e6d3a8";
const paper = "#f3efe8";
const ink = "#242220";
const mute = "#5c5852";
const body = "#ddd6cc";

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    raw[start] = 0;
    rgba.copy(raw, start + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodePng(buffer) {
  const png = new PNG(buffer);
  return new Promise((resolve, reject) => {
    try {
      png.decode((pixels) => resolve({ width: png.width, height: png.height, pixels: Buffer.from(pixels) }));
    } catch (error) {
      reject(error);
    }
  });
}

function recolorLogo(pixels, mode) {
  const next = Buffer.from(pixels);
  for (let i = 0; i < next.length; i += 4) {
    const r = next[i];
    const g = next[i + 1];
    const b = next[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 28) {
      next[i + 3] = 0;
      continue;
    }
    const goldish = r > g && g > b && r - b > 25;
    if (goldish) continue;
    if (mode === "cover") {
      next[i] = 0xe6;
      next[i + 1] = 0xd3;
      next[i + 2] = 0xa8;
    } else {
      next[i] = 0x1c;
      next[i + 1] = 0x1a;
      next[i + 2] = 0x17;
    }
    next[i + 3] = 255;
  }
  return next;
}

async function prepareLogo(mode) {
  const file = path.join(projectRoot, "tamsun-logo.png");
  return recolorLogoBuffer(readFileSync(file), mode);
}

export async function recolorLogoBuffer(buffer, mode) {
  const decoded = await decodePng(buffer);
  return encodePng(decoded.width, decoded.height, recolorLogo(decoded.pixels, mode));
}

export { moneyKzt, moneyUsd };

function moneyKzt(value) {
  const amount = Math.round(Number(value) || 0);
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₸";
}

function moneyUsd(value, rate) {
  const shown = (Number(value) || 0) / rate;
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(shown) + " $";
}

function imageBuffer(product) {
  const raw = String(product.image || "");
  if (!raw) return null;
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length < 8) return null;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpeg) return null;
  return bytes;
}

function drawCover(doc, logo, rate) {
  doc.rect(0, 0, pageWidth, pageHeight).fill(dark);
  doc.fillColor(watermark).font("Comfortaa-Bold");
  let size = 220;
  doc.fontSize(size);
  while (size > 80 && doc.widthOfString("TAMSUN") > pageWidth * 1.18) {
    size -= 4;
    doc.fontSize(size);
  }
  const wordWidth = doc.widthOfString("TAMSUN");
  doc.text("TAMSUN", (pageWidth - wordWidth) / 2, (pageHeight - size) / 2 - 8, { lineBreak: false });

  const logoWidth = 340;
  const logoHeight = logoWidth * 0.42;
  const logoX = (pageWidth - logoWidth) / 2;
  const logoY = pageHeight / 2 - logoHeight / 2 - 28;
  doc.image(logo, logoX, logoY, { fit: [logoWidth, logoHeight], align: "center", valign: "center" });

  const textTop = logoY + logoHeight + 28;
  doc.fillColor(gold).font("Comfortaa").fontSize(22);
  doc.text("Серия сувенирной продукции", 80, textTop, { width: pageWidth - 160, align: "center" });
  doc.font("Comfortaa-Bold").fontSize(40);
  doc.text("«КАТАЛОГ»", 80, textTop + 36, { width: pageWidth - 160, align: "center" });
  doc.font("Comfortaa").fontSize(18);
  doc.text("от компании Tamsun", 80, textTop + 92, { width: pageWidth - 160, align: "center" });
  doc.fillColor("#8d867c").fontSize(13);
  doc.text("Цены в тенге  ·  курс " + String(rate) + " ₸ за 1 $", 80, textTop + 128, {
    width: pageWidth - 160,
    align: "center",
  });
}

function captionLines(product) {
  const lines = [];
  const origin = String(product.origin || "").trim();
  const material = String(product.material || "").trim();
  const size = String(product.size || "").trim();
  if (origin) lines.push(origin);
  if (material) lines.push(material.startsWith("Материал") ? material : "Материал: " + material);
  if (size) lines.push(size.startsWith("Размер") ? size : "Размер: " + size);
  return lines;
}

function drawProduct(doc, product, logo, rate) {
  const left = pageWidth / 2;
  doc.rect(0, 0, left, pageHeight).fill(paper);
  doc.rect(left, 0, left, pageHeight).fill(dark);
  doc.image(logo, 42, 36, { fit: [150, 62], align: "left", valign: "center" });

  const photo = imageBuffer(product);
  const photoX = 78;
  const photoY = 130;
  const photoW = left - 156;
  const photoH = 430;
  if (photo) {
    doc.image(photo, photoX, photoY, { fit: [photoW, photoH], align: "center", valign: "center" });
  }

  const name = String(product.name || "Товар").toUpperCase();
  const lines = captionLines(product);
  doc.fillColor(ink).font("Comfortaa-Bold").fontSize(13);
  const captionTop = 590;
  doc.text(name, 48, captionTop, { width: left - 96, align: "center" });
  doc.font("Comfortaa").fontSize(11).fillColor(mute);
  lines.forEach((line, index) => {
    doc.text(line, 48, captionTop + 22 + index * 16, { width: left - 96, align: "center" });
  });

  const textX = left + 64;
  const textW = left - 128;
  const title = String(product.label || product.name || "Tamsun").toUpperCase();
  const description = String(product.description || "").trim();
  const price = moneyKzt(product.priceKzt) + "    " + moneyUsd(product.priceKzt, rate);
  doc.font("Comfortaa-Bold").fontSize(34);
  const titleH = doc.heightOfString(title, { width: textW });
  doc.font("Comfortaa").fontSize(15);
  const descH = description ? doc.heightOfString(description, { width: textW, lineGap: 3 }) : 0;
  const blockH = titleH + 28 + 22 + (description ? 28 + descH : 0);
  let y = Math.max(120, (pageHeight - blockH) / 2);
  doc.fillColor(gold).font("Comfortaa-Bold").fontSize(34);
  doc.text(title, textX, y, { width: textW });
  y += titleH + 18;
  doc.fillColor(goldBright).font("Comfortaa-Medium").fontSize(16);
  doc.text(price, textX, y, { width: textW });
  y += 28;
  doc.fillColor("#8d867c").font("Comfortaa").fontSize(11);
  doc.text("по курсу " + String(rate) + " ₸ за 1 $", textX, y, { width: textW });
  if (description) {
    y += 28;
    doc.fillColor(body).font("Comfortaa").fontSize(15);
    doc.text(description, textX, y, { width: textW, height: pageHeight - y - 56, ellipsis: true, lineGap: 3 });
  }
}

export async function buildCatalogPdf(input) {
  const rate = Number(input && input.usdRate) > 0 ? Number(input.usdRate) : 500;
  const products = Array.isArray(input && input.products) ? input.products : [];
  const coverLogo = await prepareLogo("cover");
  const sheetLogo = await prepareLogo("sheet");
  const doc = new PDFDocument({
    size: [pageWidth, pageHeight],
    margin: 0,
    autoFirstPage: false,
    info: { Title: "Tamsun — каталог", Author: "Tamsun Group" },
  });
  doc.registerFont("Comfortaa", path.join(here, "fonts", "Comfortaa-Regular.ttf"));
  doc.registerFont("Comfortaa-Medium", path.join(here, "fonts", "Comfortaa-Medium.ttf"));
  doc.registerFont("Comfortaa-Bold", path.join(here, "fonts", "Comfortaa-Bold.ttf"));
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.addPage({ size: [pageWidth, pageHeight], margin: 0 });
  drawCover(doc, coverLogo, rate);
  products.forEach((product) => {
    doc.addPage({ size: [pageWidth, pageHeight], margin: 0 });
    drawProduct(doc, product, sheetLogo, rate);
  });
  doc.end();
  return done;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return { usdRate: 500, products: [] };
  return JSON.parse(text);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const input = await readStdin();
    const pdf = await buildCatalogPdf(input);
    const outPath = process.argv[2];
    if (outPath) writeFileSync(outPath, pdf);
    else process.stdout.write(pdf);
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}
