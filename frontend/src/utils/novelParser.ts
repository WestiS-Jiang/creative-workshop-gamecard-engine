import JSZip from "jszip";

const EPUB_TEXT_FILE_RE = /\.(xhtml|html|htm)$/i;
const MOJIBAKE_RE = /[�Ãâ¤¦™œž]|锟斤拷|鈥|ï»¿/g;

export async function parseNovelFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".txt")) {
    const buffer = await file.arrayBuffer();
    return decodeTxtBuffer(buffer);
  }

  if (name.endsWith(".epub")) {
    return parseEpub(file);
  }

  throw new Error("仅支持 .txt 或 .epub 文件。");
}

export function splitTextToChunks(rawText: string, maxChunkLength = 2500): string[] {
  const text = normalizeText(rawText);
  if (!text) {
    return [];
  }

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length <= maxChunkLength) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }

    if (current) {
      chunks.push(current);
    }

    if (paragraph.length <= maxChunkLength) {
      current = paragraph;
      continue;
    }

    for (let i = 0; i < paragraph.length; i += maxChunkLength) {
      chunks.push(paragraph.slice(i, i + maxChunkLength));
    }
    current = "";
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function parseEpub(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && EPUB_TEXT_FILE_RE.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  if (entries.length === 0) {
    throw new Error("EPUB 中未找到可提取的正文文件。请检查文件是否完整。");
  }

  const pieces: string[] = [];
  for (const entry of entries) {
    const html = await entry.async("text");
    const text = htmlToText(html);
    if (text) {
      pieces.push(text);
    }
  }

  const merged = normalizeText(pieces.join("\n\n"));
  if (!merged) {
    throw new Error("EPUB 正文解析为空，请尝试上传 TXT 或检查源文件编码。");
  }

  return merged;
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = doc.body?.textContent ?? "";
  return normalizeText(text);
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeTxtBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    return "";
  }

  const bomDecoded = decodeByBom(bytes);
  if (bomDecoded) {
    return normalizeText(bomDecoded);
  }

  const encodings = ["utf-8", "gb18030", "utf-16le", "utf-16be", "big5"];
  const candidates: Array<{ encoding: string; text: string; score: number }> = [];

  for (const encoding of encodings) {
    const decoded = decodeWithEncoding(bytes, encoding);
    if (!decoded) {
      continue;
    }
    candidates.push({
      encoding,
      text: decoded,
      score: scoreDecodedText(decoded)
    });
  }

  if (candidates.length === 0) {
    return normalizeText(new TextDecoder("utf-8").decode(bytes));
  }

  candidates.sort((a, b) => b.score - a.score);
  return normalizeText(candidates[0].text);
}

function decodeByBom(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeWithEncoding(bytes, "utf-8");
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeWithEncoding(bytes, "utf-16le");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeWithEncoding(bytes, "utf-16be");
  }
  return null;
}

function decodeWithEncoding(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function scoreDecodedText(text: string): number {
  if (!text) {
    return Number.NEGATIVE_INFINITY;
  }

  const len = text.length;
  const replacementPenalty = (text.match(/�/g)?.length ?? 0) * 20;
  const mojibakePenalty = (text.match(MOJIBAKE_RE)?.length ?? 0) * 8;
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g)?.length ?? 0);
  const printableCount = (text.match(/[\p{L}\p{N}\p{P}\p{S}\s]/gu)?.length ?? 0);
  const cjkBonus = (cjkCount / len) * 120;
  const printableBonus = (printableCount / len) * 40;

  return printableBonus + cjkBonus - replacementPenalty - mojibakePenalty;
}
