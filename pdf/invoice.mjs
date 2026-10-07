import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { moneyKzt, moneyUsd, recolorLogoBuffer } from "./catalog.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageWidth = 595.28;
const pageHeight = 841.89;
const dark = "#141210";
const gold = "#c4a574";
const goldBright = "#e6d3a8";
const paper = "#f6f1e8";
const ink = "#241f1a";
const mute = "#6d675f";
const line = "#e3d8c8";
const margin = 44;
const footerH = 86;

const sellerLines = ["Tamsun Group", "Астана", "+7 701 227 15 05", "@tamsun_astana"];

function imageBuffer(value) {
  const raw = String(value || "");
  if (!raw) return null;
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length < 8) return null;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpeg) return null;
  return bytes;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function contentRight() {
  return pageWidth - margin;
}

function contentWidth() {
  return pageWidth - margin * 2;
}

function label(doc, text, x, y, width) {
  doc.fillColor(gold).font("Comfortaa-Bold").fontSize(8);
  doc.text(String(text).toUpperCase(), x, y, { width, characterSpacing: 1.1, lineBreak: false });
}

function tableColumns() {
  const photo = 58;
  const qty = 52;
  const price = 92;
  const sum = 108;
  const name = contentWidth() - photo - qty - price - sum;
  let x = margin;
  const columns = {
    photo: { x, w: photo },
    name: { x: (x += photo), w: name },
    qty: { x: (x += name), w: qty },
    price: { x: (x += qty), w: price },
    sum: { x: (x += price), w: sum },
  };
  return columns;
}

function rowHeight(doc, item) {
  const columns = tableColumns();
  doc.font("Comfortaa-Medium").fontSize(12);
  let height = doc.heightOfString(String(item.name || "Позиция"), { width: columns.name.w - 8 });
  const caption = String(item.label || "").trim();
  if (caption) {
    doc.font("Comfortaa").fontSize(9);
    height += 6 + doc.heightOfString(caption, { width: columns.name.w - 8 });
  }
  return Math.max(78, height + 22);
}

function drawPhoto(doc, item, x, y, size) {
  doc.roundedRect(x, y, size, size, 3).fill("#efe8dc");
  const photo = imageBuffer(item.image);
  if (!photo) return;
  doc.save();
  doc.roundedRect(x, y, size, size, 3).clip();
  doc.image(photo, x, y, { cover: [size, size], align: "center", valign: "center" });
  doc.restore();
}

function drawHeader(doc, logo, invoice, continued) {
  const height = continued ? 78 : 168;
  doc.rect(0, 0, pageWidth, height).fill(dark);
  doc.rect(0, height - 3, pageWidth, 3).fill(gold);
  if (logo) {
    doc.image(logo, margin, continued ? 16 : 36, { fit: [156, 54], align: "left", valign: "center" });
  } else {
    doc.fillColor(goldBright).font("Comfortaa-Bold").fontSize(18);
    doc.text("TAMSUN", margin, continued ? 28 : 52, { lineBreak: false });
  }
  const date = formatDate(invoice.createdAt);
  const number = "№ " + String(invoice.number || "—");
  doc.fillColor(gold).font("Comfortaa-Bold").fontSize(9);
  doc.text("СЧЁТ-ФАКТУРА", margin + 180, continued ? 18 : 42, {
    width: contentWidth() - 180,
    align: "right",
    characterSpacing: 1.4,
    lineBreak: false,
  });
  doc.fillColor(goldBright).font("Comfortaa-Bold").fontSize(continued ? 16 : 26);
  doc.text(number, margin + 180, continued ? 36 : 64, {
    width: contentWidth() - 180,
    align: "right",
    lineBreak: false,
  });
  if (!continued && date) {
    doc.fillColor("#d9d0c4").font("Comfortaa").fontSize(11);
    doc.text(date, margin + 180, 102, { width: contentWidth() - 180, align: "right", lineBreak: false });
  }
  return height + (continued ? 22 : 28);
}

function drawParties(doc, invoice, top) {
  const gap = 28;
  const rightW = 190;
  const leftW = contentWidth() - rightW - gap;
  const name = String(invoice.customerName || "").trim() || "Имя не указано";
  const phone = String(invoice.customerPhone || "").trim() || "Телефон не указан";
  label(doc, "Покупатель", margin, top, leftW);
  doc.fillColor(ink).font("Comfortaa-Bold").fontSize(16);
  doc.text(name, margin, top + 16, { width: leftW });
  const nameBottom = doc.y;
  doc.fillColor(mute).font("Comfortaa").fontSize(11);
  doc.text(phone, margin, nameBottom + 4, { width: leftW });
  const leftBottom = doc.y;

  const rightX = margin + leftW + gap;
  label(doc, "Поставщик", rightX, top, rightW);
  doc.fillColor(ink).font("Comfortaa").fontSize(11);
  doc.text(sellerLines.join("\n"), rightX, top + 16, { width: rightW, lineGap: 3 });
  const bottom = Math.max(leftBottom, doc.y) + 18;
  doc.moveTo(margin, bottom).lineTo(contentRight(), bottom).strokeColor(gold).lineWidth(0.8).stroke();
  return bottom + 16;
}

function drawTableHead(doc, y) {
  const columns = tableColumns();
  const titles = [
    [columns.name, "Изделие", "left"],
    [columns.qty, "Кол-во", "right"],
    [columns.price, "Цена", "right"],
    [columns.sum, "Сумма", "right"],
  ];
  doc.fillColor(mute).font("Comfortaa-Bold").fontSize(8);
  titles.forEach(([column, title, align]) => {
    const pad = align === "right" ? 2 : 0;
    doc.text(title.toUpperCase(), column.x, y, {
      width: column.w - pad,
      align,
      characterSpacing: 0.8,
      lineBreak: false,
    });
  });
  const rule = y + 16;
  doc.moveTo(margin, rule).lineTo(contentRight(), rule).strokeColor(line).lineWidth(0.6).stroke();
  return rule;
}

function drawRow(doc, item, y) {
  const columns = tableColumns();
  const height = rowHeight(doc, item);
  const photoSize = 52;
  const photoY = y + (height - photoSize) / 2;
  drawPhoto(doc, item, columns.photo.x, photoY, photoSize);

  const name = String(item.name || "Позиция");
  const caption = String(item.label || "").trim();
  doc.font("Comfortaa-Medium").fontSize(12);
  const nameH = doc.heightOfString(name, { width: columns.name.w - 8 });
  doc.font("Comfortaa").fontSize(9);
  const captionH = caption ? doc.heightOfString(caption, { width: columns.name.w - 8 }) : 0;
  const blockH = nameH + (caption ? 6 + captionH : 0);
  let textY = y + (height - blockH) / 2;
  doc.fillColor(ink).font("Comfortaa-Medium").fontSize(12);
  doc.text(name, columns.name.x, textY, { width: columns.name.w - 8 });
  if (caption) {
    doc.fillColor(gold).font("Comfortaa").fontSize(9);
    doc.text(caption, columns.name.x, textY + nameH + 4, { width: columns.name.w - 8 });
  }

  const qty = Math.max(1, Math.round(Number(item.qty) || 1));
  const mid = y + (height - 12) / 2;
  doc.fillColor(ink).font("Comfortaa").fontSize(11);
  doc.text(String(qty), columns.qty.x, mid, { width: columns.qty.w - 2, align: "right", lineBreak: false });
  doc.text(moneyKzt(item.priceKzt), columns.price.x, mid, { width: columns.price.w - 2, align: "right", lineBreak: false });
  doc.fillColor(ink).font("Comfortaa-Bold").fontSize(12);
  doc.text(moneyKzt(item.lineTotalKzt), columns.sum.x, mid - 1, { width: columns.sum.w, align: "right", lineBreak: false });
  doc.moveTo(margin, y + height).lineTo(contentRight(), y + height).strokeColor(line).lineWidth(0.5).stroke();
  return y + height;
}

function drawTotals(doc, invoice, y) {
  const rate = Number(invoice.usdRate) > 0 ? Number(invoice.usdRate) : 500;
  const boxW = 250;
  const x = contentRight() - boxW;
  doc.fillColor(mute).font("Comfortaa").fontSize(10);
  doc.text("Курс " + String(rate) + " ₸ за 1 $", x, y, { width: boxW, align: "right", lineBreak: false });
  doc.text("В долларах", x, y + 22, { width: 110, lineBreak: false });
  doc.fillColor(ink).font("Comfortaa-Medium").fontSize(12);
  doc.text(moneyUsd(invoice.totalKzt, rate), x + 110, y + 20, { width: boxW - 110, align: "right", lineBreak: false });
  const rule = y + 46;
  doc.moveTo(x, rule).lineTo(contentRight(), rule).strokeColor(gold).lineWidth(1).stroke();
  doc.fillColor(gold).font("Comfortaa-Bold").fontSize(9);
  doc.text("ИТОГО", x, rule + 14, { width: 80, characterSpacing: 1.2, lineBreak: false });
  doc.fillColor(ink).font("Comfortaa-Bold").fontSize(20);
  doc.text(moneyKzt(invoice.totalKzt), x + 80, rule + 8, { width: boxW - 80, align: "right", lineBreak: false });
  return rule + 40;
}

function measureParties(doc, invoice) {
  const gap = 28;
  const rightW = 190;
  const leftW = contentWidth() - rightW - gap;
  const name = String(invoice.customerName || "").trim() || "Имя не указано";
  const phone = String(invoice.customerPhone || "").trim() || "Телефон не указан";
  doc.font("Comfortaa-Bold").fontSize(16);
  const nameH = doc.heightOfString(name, { width: leftW });
  doc.font("Comfortaa").fontSize(11);
  const phoneH = doc.heightOfString(phone, { width: leftW });
  const left = 16 + nameH + 4 + phoneH;
  const right = 16 + doc.heightOfString(sellerLines.join("\n"), { width: rightW, lineGap: 3 });
  return Math.max(left, right) + 34;
}

function planPages(doc, invoice, items) {
  const totalsBlock = 108;
  const afterTotals = 16;
  const pages = [];
  let index = 0;
  let continued = false;
  while (pages.length === 0 || index < items.length) {
    const first = pages.length === 0;
    let y = first ? 196 + measureParties(doc, invoice) : 100;
    y += 16;
    const start = index;
    while (index < items.length) {
      const height = rowHeight(doc, items[index]);
      const tail = index + 1 >= items.length ? totalsBlock + afterTotals + footerH : 0;
      if (start !== index && y + height + tail > pageHeight) break;
      y += height;
      index += 1;
      if (y + totalsBlock + afterTotals + footerH > pageHeight && index < items.length) break;
    }
    if (!items.length) y += 54;
    const closing = index >= items.length;
    if (closing) y += totalsBlock + afterTotals + footerH;
    pages.push({
      start,
      end: index,
      continued,
      height: Math.min(pageHeight, Math.ceil(y)),
    });
    continued = true;
    if (closing) break;
  }
  return pages;
}

function drawFooter(doc, top) {
  doc.rect(0, top, pageWidth, footerH).fill(dark);
  doc.rect(0, top, pageWidth, 3).fill(gold);
  doc.fillColor(goldBright).font("Comfortaa-Bold").fontSize(11);
  doc.text("Tamsun Group", margin, top + 18, { width: 220, lineBreak: false });
  doc.fillColor("#d9d0c4").font("Comfortaa").fontSize(9);
  doc.text("Астана  ·  WhatsApp +7 701 227 15 05", margin, top + 36, { width: 280, lineBreak: false });
  doc.text("Instagram @tamsun_astana", margin, top + 52, { width: 280, lineBreak: false });
  doc.fillColor("#b7aea3").font("Comfortaa").fontSize(8);
  doc.text("Цены в тенге зафиксированы в заказе.", margin + 250, top + 36, {
    width: contentWidth() - 250,
    align: "right",
  });
}

export async function buildInvoicePdf(input) {
  const invoice = input || {};
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const logoBytes = imageBuffer(invoice.logo);
  let logo = null;
  if (logoBytes && logoBytes[0] === 0x89) {
    try {
      logo = await recolorLogoBuffer(logoBytes, "cover");
    } catch {
      logo = null;
    }
  }
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: false,
    info: { Title: "Tamsun — счёт-фактура № " + String(invoice.number || ""), Author: "Tamsun Group" },
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

  const ruler = new PDFDocument({ size: "A4", margin: 0 });
  ruler.registerFont("Comfortaa", path.join(here, "fonts", "Comfortaa-Regular.ttf"));
  ruler.registerFont("Comfortaa-Medium", path.join(here, "fonts", "Comfortaa-Medium.ttf"));
  ruler.registerFont("Comfortaa-Bold", path.join(here, "fonts", "Comfortaa-Bold.ttf"));
  ruler.addPage({ size: "A4", margin: 0 });
  const pages = planPages(ruler, invoice, items);
  ruler.end();

  pages.forEach((page, pageIndex) => {
    doc.addPage({ size: [pageWidth, page.height], margin: 0 });
    doc.rect(0, 0, pageWidth, page.height).fill(paper);
    let y = drawHeader(doc, logo, invoice, page.continued);
    if (pageIndex === 0) y = drawParties(doc, invoice, y);
    y = drawTableHead(doc, y);
    const slice = items.slice(page.start, page.end);
    if (!slice.length) {
      doc.fillColor(mute).font("Comfortaa").fontSize(12);
      doc.text("В заказе нет позиций.", margin, y + 22, { width: contentWidth() });
      y = doc.y + 12;
    }
    slice.forEach((item) => {
      y = drawRow(doc, item, y);
    });
    if (pageIndex === pages.length - 1) {
      y = drawTotals(doc, invoice, y + 22);
      drawFooter(doc, page.height - footerH);
    }
  });
  doc.end();
  return done;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return { items: [] };
  return JSON.parse(text);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const input = await readStdin();
    const pdf = await buildInvoicePdf(input);
    const outPath = process.argv[2];
    if (outPath) writeFileSync(outPath, pdf);
    else process.stdout.write(pdf);
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}
