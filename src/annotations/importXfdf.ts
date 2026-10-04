import { PDFDocument } from "pdf-lib";
import { uid, type DocumentModel, type ImportedMarkup, type Point, type ReviewStatus } from "../state/model";

const namespace = "http://ns.adobe.com/xfdf/";
const maxBytes = 8 * 1024 * 1024;
const supported = new Set(["text", "highlight", "underline", "strikeout", "ink"]);
const subtypes = { text: "Text", highlight: "Highlight", underline: "Underline", strikeout: "StrikeOut", ink: "Ink" } as const;
const states = new Set<ReviewStatus>(["None", "Accepted", "Rejected", "Cancelled", "Completed"]);
const flagBits: Record<string, number> = { invisible: 1, hidden: 2, print: 4, nozoom: 8, norotate: 16,
  noview: 32, readonly: 64, locked: 128, togglenoview: 256, lockedcontents: 512 };

function attributes(element: Element, allowed: readonly string[]) {
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.namespaceURI === "http://www.w3.org/2000/xmlns/") continue;
    if (attribute.namespaceURI === "http://www.w3.org/XML/1998/namespace" && attribute.localName === "space") continue;
    if (attribute.namespaceURI || !allowed.includes(attribute.name))
      throw Error(`XFDFの未対応属性です: ${element.localName}/${attribute.name}`);
  }
}
function children(element: Element) {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) throw Error("XFDFの要素構造が不正です。");
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.COMMENT_NODE)
      throw Error("XFDFに未対応のXML要素があります。");
  }
  const result = Array.from(element.children);
  if (result.some(child => child.namespaceURI !== namespace)) throw Error("XFDFの名前空間が不正です。");
  return result;
}
function numbers(value: string | null, label: string): number[] {
  const text = value?.trim();
  if (!text || /^[,;]/.test(text) || /[,;]$/.test(text) || /[,;]\s*[,;]/.test(text)) throw Error(`${label}が不正です。`);
  const tokens = text.split(/[\s,;]+/);
  if (tokens.length > 200000 || tokens.some(token => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token)))
    throw Error(`${label}が不正です。`);
  const result = tokens.map(Number);
  if (result.some(value => !Number.isFinite(value) || Math.abs(value) > 1e7)) throw Error(`${label}の範囲が不正です。`);
  return result;
}
function scalar(element: Element, key: string, fallback: number, min: number, max: number) {
  const value = element.getAttribute(key);
  if (value === null) return fallback;
  const parsed = numbers(value, key);
  if (parsed.length !== 1 || parsed[0] < min || parsed[0] > max) throw Error(`XFDFの${key}が不正です。`);
  return parsed[0];
}
function stringAttribute(element: Element, key: string, limit = 10000) {
  const value = element.getAttribute(key);
  if (value !== null && value.length > limit) throw Error(`XFDFの${key}が長すぎます。`);
  return value ?? undefined;
}
function decode(bytes: Uint8Array) {
  if (bytes.length === 0 || bytes.length > maxBytes) throw Error("XFDFファイルは空でない8MB以下のファイルを選んでください。");
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : undefined;
  let text: string;
  try { text = new TextDecoder(utf16 ?? "utf-8", { fatal: true }).decode(bytes); }
  catch { throw Error("XFDFの文字コードを読み込めません。UTF-8またはBOM付きUTF-16を使用してください。"); }
  const encoding = text.match(/^\s*<\?xml\s[^?]*encoding\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase();
  if (encoding && !(utf16 ? ["utf-16", utf16].includes(encoding) : ["utf-8", "utf8"].includes(encoding)))
    throw Error("XFDFの文字コード宣言が対応するUTF-8／UTF-16ではありません。");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw Error("DTDや外部エンティティを含むXFDFは読み込めません。");
  return text;
}

/** Parse completely before returning additions; the caller commits them together. */
export async function parseXfdf(bytes: Uint8Array, model: DocumentModel): Promise<{
  entries: { pageId: string; markup: ImportedMarkup }[]; reference?: string;
}> {
  const document = new DOMParser().parseFromString(decode(bytes), "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw Error("XFDFのXMLを解析できません。");
  const root = document.documentElement;
  if (root.localName !== "xfdf" || root.namespaceURI !== namespace) throw Error("XFDFのルート要素・名前空間が不正です。");
  attributes(root, []);
  const sections = children(root);
  if (sections.some(element => !["annots", "f", "fields", "ids"].includes(element.localName)))
    throw Error("XFDFに未対応のデータがあります。");
  for (const type of ["annots", "f", "fields", "ids"])
    if (sections.filter(element => element.localName === type).length > 1) throw Error(`XFDFの${type}が重複しています。`);
  const fields = sections.find(element => element.localName === "fields");
  if (fields) {
    attributes(fields, []);
    if (children(fields).length) throw Error("フォーム値を含むXFDFの読み込みは未対応です。");
  }
  const referenceNode = sections.find(element => element.localName === "f");
  if (referenceNode) { attributes(referenceNode, ["href"]); if (children(referenceNode).length) throw Error("XFDFの参照情報が不正です。"); }
  const reference = referenceNode ? stringAttribute(referenceNode, "href") : undefined;
  const ids = sections.find(element => element.localName === "ids");
  if (ids) { attributes(ids, ["original", "modified"]); if (children(ids).length) throw Error("XFDFの文書IDが不正です。"); }
  const annots = sections.find(element => element.localName === "annots");
  if (!annots) throw Error("XFDFに注釈一覧がありません。");
  attributes(annots, []);
  const annotations = children(annots);
  if (!annotations.length || annotations.length > 5000) throw Error("XFDFの注釈数は1〜5000件にしてください。");
  const sources = new Map<string, Promise<PDFDocument>>();
  const names = new Set<string>();
  const entries: { pageId: string; markup: ImportedMarkup }[] = [];
  let pointCount = 0;
  const consumePoints = (count: number) => {
    pointCount += count;
    if (pointCount > 100000) throw Error("XFDFの注釈座標が10万点を超えています。");
  };
  for (const annotation of annotations) {
    const tag = annotation.localName;
    if (!supported.has(tag)) throw Error(`XFDF読み込みに未対応の注釈です: ${tag}`);
    attributes(annotation, ["page", "rect", "name", "title", "subject", "date", "creationdate", "color", "opacity", "flags",
      ...(tag === "text" ? ["icon", "statemodel", "state"] : tag === "ink" ? ["width", "style"] : ["coords", "width"])]);
    const pageValue = annotation.getAttribute("page")?.trim();
    if (!pageValue || !/^\d+$/.test(pageValue)) throw Error("XFDFのページ番号が不正です。");
    const index = Number(pageValue), page = model.pages[index];
    if (!Number.isSafeInteger(index) || !page) throw Error("XFDFのページ番号が現在のPDFの範囲外です。");
    const originalName = stringAttribute(annotation, "name");
    if (originalName) {
      if (names.has(originalName)) throw Error("XFDFの注釈名が重複しています。");
      names.add(originalName);
    }
    const rect = numbers(annotation.getAttribute("rect"), "注釈の範囲");
    if (rect.length !== 4) throw Error("XFDFの注釈範囲は4つの座標が必要です。");
    let origin = { x: 0, y: 0 };
    if (page.sourceId) {
      const source = model.sources[page.sourceId];
      if (!source) throw Error("注釈を配置するPDFの参照元がありません。");
      let loaded = sources.get(page.sourceId);
      if (!loaded) { loaded = PDFDocument.load(source.bytes); sources.set(page.sourceId, loaded); }
      origin = (await loaded).getPage(page.sourceIndex).getCropBox();
    }
    const convert = (x: number, y: number): Point => {
      const point = { x: x - origin.x, y: origin.y + page.height - y };
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1e6 || Math.abs(point.y) > 1e6)
        throw Error("XFDFの注釈座標が配置できる範囲を超えています。");
      return point;
    };
    const upper = convert(Math.min(rect[0], rect[2]), Math.max(rect[1], rect[3]));
    const width = Math.abs(rect[2] - rect[0]), height = Math.abs(rect[3] - rect[1]);
    if (width <= 0 || height <= 0 || width > 100000 || height > 100000) throw Error("XFDFの注釈サイズが不正です。");
    const nested = children(annotation);
    if (nested.some(child => !["contents", ...(tag === "ink" ? ["inklist"] : [])].includes(child.localName)))
      throw Error(`XFDFの注釈に未対応の情報があります: ${tag}`);
    const contents = nested.filter(child => child.localName === "contents");
    if (contents.length > 1) throw Error("XFDFの本文が重複しています。");
    if (contents[0]) {
      attributes(contents[0], []);
      if (contents[0].children.length) throw Error("XFDFのリッチテキストは読み込めません。");
    }
    const text = contents[0]?.textContent ?? "";
    if (text.length > 1_000_000) throw Error("XFDFの本文が長すぎます。");
    const colorValue = annotation.getAttribute("color");
    if (colorValue !== null && colorValue !== "" && !/^#[\da-f]{6}$/i.test(colorValue)) throw Error("XFDFの色が不正です。");
    const color = colorValue === "" ? null : colorValue ?? (tag === "text" || tag === "highlight" ? "#ffcc33" : "#263445");
    let flags = 4;
    if (annotation.hasAttribute("flags")) {
      flags = 0;
      const value = annotation.getAttribute("flags")!;
      if (value.trim()) for (const token of value.split(",").map(part => part.trim().toLowerCase())) {
        if (!Object.hasOwn(flagBits, token)) throw Error(`XFDFの注釈フラグが未対応です: ${token}`);
        flags |= flagBits[token];
      }
    }
    const stateModel = annotation.getAttribute("statemodel"), stateValue = annotation.getAttribute("state");
    if ((stateModel || stateValue) && (tag !== "text" || stateModel !== "Review" || !states.has(stateValue as ReviewStatus)))
      throw Error("XFDFのレビュー状態が未対応です。");
    const markup: ImportedMarkup = { id: uid(), subtype: subtypes[tag as keyof typeof subtypes],
      ...upper, width, height, text, author: stringAttribute(annotation, "title") ?? "",
      reviewStatus: (stateValue ?? "None") as ReviewStatus, color, flags,
      opacity: scalar(annotation, "opacity", 1, 0, 1), strokeWidth: scalar(annotation, "width", 2, 0, 1000),
      ...(originalName ? { name: originalName } : {}),
      ...(tag === "text" && annotation.hasAttribute("icon") ? { icon: stringAttribute(annotation, "icon", 100) } : {}),
      ...(annotation.hasAttribute("date") ? { date: stringAttribute(annotation, "date", 200) } : {}),
      ...(annotation.hasAttribute("creationdate") ? { creationDate: stringAttribute(annotation, "creationdate", 200) } : {}),
      ...(annotation.hasAttribute("subject") ? { subject: stringAttribute(annotation, "subject") } : {}),
    };
    if (["highlight", "underline", "strikeout"].includes(tag)) {
      const coords = numbers(annotation.getAttribute("coords"), "強調領域の座標");
      if (coords.length < 8 || coords.length % 8) throw Error("XFDFの強調領域は8座標ごとに指定してください。");
      consumePoints(coords.length / 2);
      markup.quadPoints = Array.from({ length: coords.length / 2 }, (_, i) => convert(coords[2 * i], coords[2 * i + 1]));
    } else if (tag === "ink") {
      const style = annotation.getAttribute("style");
      if (style && style !== "solid") throw Error("XFDFの手描き線は実線に対応します。");
      const lists = nested.filter(child => child.localName === "inklist");
      if (lists.length !== 1) throw Error("XFDFの手描き座標がありません。");
      attributes(lists[0], []);
      const gestures = children(lists[0]);
      if (!gestures.length || gestures.length > 10000 || gestures.some(gesture => gesture.localName !== "gesture")) throw Error("XFDFの手描き座標が不正です。");
      markup.gestures = gestures.map(gesture => {
        attributes(gesture, []);
        if (gesture.children.length) throw Error("XFDFの手描き経路が不正です。");
        const coords = numbers(gesture.textContent, "手描き経路");
        if (coords.length < 2 || coords.length % 2) throw Error("XFDFの手描き座標は2座標ごとに指定してください。");
        consumePoints(coords.length / 2);
        return Array.from({ length: coords.length / 2 }, (_, i) => convert(coords[2 * i], coords[2 * i + 1]));
      });
    }
    entries.push({ pageId: page.id, markup });
  }
  return { entries, reference };
}
