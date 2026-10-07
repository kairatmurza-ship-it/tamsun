import { inflateRawSync } from "node:zlib";

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function chatBytes(data) {
  const clean = String(data || "").replace(/\s/g, "");
  if (clean.length < 8 || clean.length > 4000000) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null;
  try {
    return Buffer.from(clean, "base64");
  } catch (error) {
    return null;
  }
}

function plainFromXml(xml, breakTag) {
  let text = String(xml || "");
  if (breakTag) text = text.split(breakTag).join("\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const lines = [];
  let joined = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    lines.push(line);
    joined = lines.join("\n");
    if (joined.length > 8000) break;
  }
  if (joined.length > 8000) joined = joined.slice(0, 8000);
  return joined.trim();
}

function readZipEntry(buffer, entryName) {
  const maxBack = Math.min(buffer.length, 66000);
  let eocd = -1;
  const start = Math.max(0, buffer.length - maxBack);
  for (let i = buffer.length - 22; i >= start; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return Buffer.alloc(0);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLen).toString("utf8");
    offset += 46 + nameLen + extraLen + commentLen;
    if (name !== entryName) continue;
    if (localOffset + 30 > buffer.length) return Buffer.alloc(0);
    const nameLenLocal = buffer.readUInt16LE(localOffset + 26);
    const extraLenLocal = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + nameLenLocal + extraLenLocal;
    const data = buffer.slice(dataStart, dataStart + compSize);
    if (method === 0) return data;
    if (method === 8) {
      try {
        return inflateRawSync(data, { maxOutputLength: 1000000 });
      } catch (error) {
        return Buffer.alloc(0);
      }
    }
    return Buffer.alloc(0);
  }
  return Buffer.alloc(0);
}

function sheetCellText(xml) {
  const cells = [];
  const pattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let match;
  while ((match = pattern.exec(xml)) && cells.length < 200) {
    const attrs = match[1] || "";
    if (/\bt="(?:s|inlineStr)"/.test(attrs)) continue;
    const value = /<v[^>]*>([^<]*)<\/v>/.exec(match[2] || "");
    if (!value) continue;
    const text = value[1].replace(/\s+/g, " ").trim();
    if (text) cells.push(text);
  }
  return cells.join("\n");
}

function readZipXml(bytes, entryName) {
  try {
    const xml = readZipEntry(bytes, entryName).toString("utf8");
    return xml.length > 400000 ? xml.slice(0, 400000) : xml;
  } catch (error) {
    return "";
  }
}

export function convertChatAttachment(file) {
  let name = String(file.name || "").split(/[/\\]/).pop() || "file";
  if (name.length > 80) name = name.slice(0, 80);
  let mime = String(file.type || "").toLowerCase();
  const lower = name.toLowerCase();
  if (!mime || mime === "application/octet-stream") {
    if (/\.(jpg|jpeg)$/.test(lower)) mime = "image/jpeg";
    else if (/\.png$/.test(lower)) mime = "image/png";
    else if (/\.gif$/.test(lower)) mime = "image/gif";
    else if (/\.webp$/.test(lower)) mime = "image/webp";
    else if (/\.pdf$/.test(lower)) mime = "application/pdf";
    else if (/\.docx$/.test(lower)) mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    else if (/\.xlsx$/.test(lower)) mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    else if (/\.(txt|csv|json|md|xml|html|svg|log)$/.test(lower)) mime = "text/plain";
  }
  const bytes = chatBytes(file.data);
  if (!bytes) return { kind: "text", text: `Attached file ${name} could not be opened.` };
  const clean = String(file.data || "").replace(/\s/g, "");
  if (/^image\/(jpeg|png|gif|webp)$/.test(mime)) {
    return {
      kind: "media",
      body: { type: "image_url", image_url: { url: `data:${mime};base64,${clean}` } },
    };
  }
  if (mime === "application/pdf" || /\.pdf$/.test(lower)) {
    return {
      kind: "media",
      body: {
        type: "file",
        file: {
          filename: name,
          file_data: `data:application/pdf;base64,${clean}`,
        },
      },
    };
  }
  if (/\.docx$/.test(lower) || /wordprocessingml/.test(mime)) {
    let plain = plainFromXml(readZipXml(bytes, "word/document.xml"), "</w:p>");
    if (!plain) plain = "The document had no readable text.";
    return { kind: "text", text: `File ${name}:\n${plain}` };
  }
  if (/\.xlsx$/.test(lower) || /spreadsheetml/.test(mime)) {
    const shared = plainFromXml(readZipXml(bytes, "xl/sharedStrings.xml"), "</si>");
    const numbers = sheetCellText(readZipXml(bytes, "xl/worksheets/sheet1.xml"));
    let plain = [shared, numbers].filter(Boolean).join("\n");
    if (plain.length > 8000) plain = plain.slice(0, 8000);
    if (!plain) plain = "The spreadsheet had no readable text.";
    return { kind: "text", text: `Spreadsheet ${name}:\n${plain}` };
  }
  const textLike = /^text\//.test(mime) || /\.(txt|csv|json|md|xml|html|svg|log|rtf)$/.test(lower);
  if (!textLike) {
    const sample = Math.min(200, bytes.length);
    let printable = 0;
    for (let i = 0; i < sample; i++) {
      const b = bytes[i];
      if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) printable++;
    }
    if (sample === 0 || printable / sample < 0.8) {
      const label = mime || "unknown type";
      return {
        kind: "text",
        text: `Attached file ${name} (${label}, ${bytes.length} bytes). The contents are not readable text. Acknowledge the file by name. Do not invent its contents and do not ask for a different format.`,
      };
    }
  }
  let decoded = bytes.toString("utf8");
  if (decoded.length > 8000) decoded = decoded.slice(0, 8000);
  return { kind: "text", text: `File ${name}:\n${decoded}` };
}

export function prepareAttachments(payload) {
  const prepared = [];
  for (const file of asArray(payload && payload.attachments)) {
    if (prepared.length >= 4) break;
    const part = convertChatAttachment(file);
    if (part) prepared.push(part);
  }
  return prepared;
}
