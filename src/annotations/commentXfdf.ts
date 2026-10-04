import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFObject,
} from "pdf-lib";
import type { DocumentModel, EditObject } from "../state/model";
import type { CommentRow } from "./comments";
import { importedMarkupPdfGeometry } from "./pdfImportedMarkup";

const name = (key: string) => PDFName.of(key);
const supported = new Set(["Text", "Highlight", "Underline", "StrikeOut", "Ink"]);
// XML 1.0 excludes control characters and surrogate code points.
// eslint-disable-next-line no-control-regex
const invalidXml = /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu;

function xml(value: string): string {
  return value.replace(invalidXml, "\ufffd")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\t", "&#9;");
}

function safeXmlText(value: string): string {
  return value.replace(invalidXml, "\ufffd");
}

function numericArray(array: PDFArray, label: string, min: number, multiple = 1): number[] {
  const result: number[] = [];
  if (array.size() < min || array.size() > 1_000_000 || array.size() % multiple !== 0)
    throw Error(`${label}の座標配列が不正です。`);
  for (let i = 0; i < array.size(); i++) {
    const value = array.lookupMaybe(i, PDFNumber)?.asNumber();
    if (value === undefined || !Number.isFinite(value) || Math.abs(value) > 1e7)
      throw Error(`${label}の座標が不正です。`);
    result.push(value);
  }
  return result;
}

function attr(key: string, value: string | number | undefined): string {
  return value === undefined ? "" : ` ${key}="${xml(String(value))}"`;
}

function pdfString(dict: PDFDict, key: string): string | undefined {
  const value = dict.lookupMaybe(name(key), PDFString, PDFHexString);
  return value?.decodeText();
}

function pdfName(dict: PDFDict, key: string): string | undefined {
  return dict.lookupMaybe(name(key), PDFName)?.decodeText();
}

function refId(ref: PDFObject): string | undefined {
  if (!(ref instanceof PDFRef)) return;
  return `${ref.objectNumber}R${ref.generationNumber || ""}`;
}

function resolveSourceAnnotation(
  model: DocumentModel,
  page: DocumentModel["pages"][number],
  row: CommentRow,
  documents: Map<string, PDFDocument>,
): { dict: PDFDict; pdf: PDFDocument } {
  if (!page.sourceId) throw Error("既存コメントの参照元PDFがありません。");
  const source = model.sources[page.sourceId];
  if (!source) throw Error("既存コメントの参照元PDFがありません。");
  const pdf = documents.get(page.sourceId);
  if (!pdf) throw Error("既存コメントの読み込みが完了していません。");
  const sourcePage = pdf.getPage(page.sourceIndex);
  const annotations = sourcePage.node.Annots();
  if (!annotations) throw Error("既存コメントが参照元PDFにありません。");
  for (let i = 0; i < annotations.size(); i++) {
    const ref = annotations.get(i);
    if (refId(ref) !== row.id) continue;
    const candidate = annotations.lookup(i);
    if (!(candidate instanceof PDFDict)) break;
    return { dict: candidate, pdf };
  }
  throw Error("既存コメントの参照先を参照元PDFで確認できません。");
}

function pdfDate(dict: PDFDict, key: string): string | undefined {
  return pdfString(dict, key);
}

function colorAttribute(dict: PDFDict, fallback?: string): string | undefined {
  const c = dict.lookupMaybe(name("C"), PDFArray);
  if (!c) return fallback;
  if (c.size() === 0) return "";
  if (![1, 3, 4].includes(c.size())) throw Error("XFDFで表現できないコメント色です。");
  const values = numericArray(c, "コメント色", c.size());
  if (values.some((v) => v < 0 || v > 1)) throw Error("コメントの色が不正です。");
  const channels = c.size() === 1 ? [values[0], values[0], values[0]] : c.size() === 4
    ? values.slice(0, 3).map((v) => 1 - Math.min(1, v + values[3]))
    : values;
  const rgb = channels.map((v) => {
    return Math.round(v * 255).toString(16).padStart(2, "0");
  });
  return `#${rgb.join("")}`.toUpperCase();
}

function flagsAttribute(dict: PDFDict): string | undefined {
  const flags = dict.lookupMaybe(name("F"), PDFNumber)?.asNumber();
  if (flags === undefined) return undefined;
  if (!Number.isInteger(flags) || flags < 0) throw Error("コメントのフラグが不正です。");
  const bits: [number, string][] = [
    [1, "invisible"], [2, "hidden"], [4, "print"], [8, "nozoom"],
    [16, "norotate"], [32, "noview"], [64, "readonly"], [128, "locked"],
    [256, "togglenoview"], [512, "lockedcontents"],
  ];
  return bits.filter(([bit]) => (flags & bit) !== 0).map(([, token]) => token).join(",");
}

function commonAttributes(
  row: CommentRow,
  dict: PDFDict,
  subtype: string,
  identity: string,
  rect: readonly number[],
  color: string | undefined,
): string {
  const opacity = dict.lookupMaybe(name("CA"), PDFNumber)?.asNumber();
  if (opacity !== undefined && (!Number.isFinite(opacity) || opacity < 0 || opacity > 1))
    throw Error("コメントの不透明度が不正です。");
  const state = subtype === "Text" && row.reviewable ? row.reviewStatus : undefined;
  const stateAttrs = state === undefined ? "" : ` statemodel="Review" state="${xml(state)}"`;
  return attr("page", row.pageIndex) +
    attr("rect", rect.join(",")) +
    attr("name", identity) +
    attr("title", row.author) +
    attr("subject", pdfString(dict, "Subj")) +
    attr("date", pdfDate(dict, "M")) +
    attr("creationdate", pdfDate(dict, "CreationDate")) +
    attr("color", color) +
    attr("opacity", opacity) +
    attr("flags", flagsAttribute(dict)) +
    stateAttrs;
}

function rectFrom(dict: PDFDict): number[] {
  const rect = dict.lookupMaybe(name("Rect"), PDFArray);
  if (!rect) throw Error("コメントのページ範囲がありません。");
  const values = numericArray(rect, "コメント範囲", 4);
  if (values.length !== 4)
    throw Error("コメントのページ範囲が不正です。");
  return [Math.min(values[0], values[2]), Math.min(values[1], values[3]), Math.max(values[0], values[2]), Math.max(values[1], values[3])];
}

function annotationXml(
  row: CommentRow,
  dict: PDFDict,
  subtype: string,
  identity: string,
  geometry?: { coords?: number[]; ink?: number[][]; rect?: number[] },
  fallbackColor?: string,
): string {
  if (!supported.has(subtype)) throw Error(`XFDF出力に未対応のコメント形式です: ${subtype || "不明"}`);
  const rect = geometry?.rect ?? rectFrom(dict);
  const color = colorAttribute(dict, fallbackColor);
  const common = commonAttributes(row, dict, subtype, identity, rect, color);
  const contents = `<contents>${xml(row.text)}</contents>`;
  if (subtype === "Text") {
    const icon = pdfName(dict, "Name") ?? "Comment";
    return `<text${common}${attr("icon", icon)}>${contents}</text>`;
  }
  const width = dict.lookupMaybe(name("BS"), PDFDict)?.lookupMaybe(name("W"), PDFNumber)?.asNumber();
  if (width !== undefined && (!Number.isFinite(width) || width < 0)) throw Error("コメントの線幅が不正です。");
  if (subtype === "Ink") {
    const gestures = geometry?.ink;
    if (!gestures?.length) throw Error("インクコメントの座標がありません。");
    const inklist = gestures.map((gesture) => `<gesture>${Array.from({ length: gesture.length / 2 }, (_, i) => `${gesture[i * 2]},${gesture[i * 2 + 1]}`).join(";")}</gesture>`).join("");
    return `<ink${common}${attr("width", width)}>${contents}<inklist>${inklist}</inklist></ink>`;
  }
  const coords = geometry?.coords;
  if (!coords || coords.length < 8 || coords.length % 8 !== 0)
    throw Error(`${subtype}コメントのQuadPointsが不正です。`);
  const tag = subtype.toLowerCase();
  return `<${tag}${common}${attr("width", width)}${attr("coords", coords.join(","))}>${contents}</${tag}>`;
}

function objectDictionary(context: PDFDocument["context"], object: EditObject): PDFDict {
  const color = object.kind === "note"
    ? [1, 0.8, 0.2]
    : [1, 3, 5].map((i) => parseInt(object.color.slice(i, i + 2), 16) / 255);
  return context.obj({
    F: 4,
    ...(object.kind === "note" ? {} : { CA: object.opacity, BS: { W: object.strokeWidth } }),
    C: color,
    Name: "Comment",
  }) as PDFDict;
}

function addedGeometry(
  object: EditObject,
  page: DocumentModel["pages"][number],
  origin: { x: number; y: number },
): { subtype: string; rect: number[]; coords?: number[]; ink?: number[][] } {
  if (![object.x, object.y, object.width, object.height, object.strokeWidth, object.opacity].every(Number.isFinite) ||
    !/^#[\da-f]{6}$/i.test(object.color) || object.width < 0 || object.height < 0 ||
    object.strokeWidth < 0 || object.opacity < 0 || object.opacity > 1)
    throw Error("追加コメントの座標または書式が不正です。");
  const x = origin.x + object.x;
  const top = origin.y + page.height - object.y;
  if (object.kind === "note")
    return { subtype: "Text", rect: [x, top - object.height, x + 24, top - object.height + 24] };
  const w = object.width, h = object.height, m = Math.max(2, object.strokeWidth);
  if (![object.x, object.y, w, h, object.strokeWidth].every(Number.isFinite) || w < 0 || h < 0)
    throw Error("追加コメントの座標が不正です。");
  const rect = [x - m, top - h - m, x + w + m, top + m];
  if (object.kind === "ink") {
    const points = object.points ?? [];
    if (!points.length || points.length > 100_000 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
      throw Error("インクコメントの座標が不正です。");
    return {
      subtype: "Ink", rect,
      ink: [points.flatMap((p) => [x + p.x, top - p.y])],
    };
  }
  const coords = [x, top, x + w, top, x, top - h, x + w, top - h];
  return { subtype: object.kind === "strike" ? "StrikeOut" : object.kind === "underline" ? "Underline" : "Highlight", rect, coords };
}

/** Export the supplied comment rows as UTF-8 XFDF, preserving PDF user-space geometry. */
export async function commentsXfdf(model: DocumentModel, rows: readonly CommentRow[]): Promise<Uint8Array> {
  if (rows.length > 100_000) throw Error("XFDFへ出力できるコメント数を超えています。");
  const documents = new Map<string, PDFDocument>();
  const sources = new Set(rows.map((row) => {
    const page = model.pages.find((p) => p.id === row.pageId);
    if (!page) throw Error("コメントのページ参照が現在の文書と一致しません。");
    if (!page.sourceId && !row.added && !row.importedMarkup) throw Error("既存コメントの参照元PDFがありません。");
    return page.sourceId;
  }).filter((sourceId): sourceId is string => !!sourceId));
  for (const sourceId of sources) {
    const source = model.sources[sourceId];
    if (!source) throw Error("コメントの参照元PDFがありません。");
    documents.set(sourceId, await PDFDocument.load(source.bytes));
  }
  const generated = await PDFDocument.create();
  const usedNames = new Set<string>();
  const output: string[] = [];
  for (const row of rows) {
    const pageIndex = model.pages.findIndex((p) => p.id === row.pageId);
    const page = model.pages[pageIndex];
    if (!page || pageIndex < 0 || row.pageIndex !== pageIndex || !Number.isInteger(pageIndex))
      throw Error("コメントのページ参照が現在の文書と一致しません。");
    if (typeof row.text !== "string" || typeof row.author !== "string")
      throw Error("コメント本文または作成者が不正です。");
    let dict: PDFDict, subtype: string, identity: string, geometry: { coords?: number[]; ink?: number[][]; rect?: number[] } | undefined;
    if (row.importedMarkup) {
      const markup = page.importedMarkups?.find(candidate => candidate.id === row.id);
      if (!markup) throw Error("読み込んだコメントの参照先がありません。");
      const origin = page.sourceId ? documents.get(page.sourceId)?.getPage(page.sourceIndex).getCropBox() : undefined;
      const raw = importedMarkupPdfGeometry(markup, page.height, origin);
      geometry = { rect: raw.rect, coords: raw.quadPoints, ink: raw.inkList };
      subtype = markup.subtype;
      identity = markup.id;
      dict = generated.context.obj({
        C: markup.color === null ? [] : [1, 3, 5].map(i => parseInt(markup.color!.slice(i, i + 2), 16) / 255),
        CA: markup.opacity, F: markup.flags ?? 4, BS: { W: markup.strokeWidth },
        Name: markup.icon ?? "Comment",
        ...(markup.date !== undefined ? { M: PDFHexString.fromText(markup.date) } : {}),
        ...(markup.creationDate !== undefined ? { CreationDate: PDFHexString.fromText(markup.creationDate) } : {}),
        ...(markup.subject !== undefined ? { Subj: PDFHexString.fromText(markup.subject) } : {}),
      }) as PDFDict;
    } else if (row.added) {
      const object = page.objects.find((candidate) => candidate.id === row.id);
      if (!object || !["note", "highlight", "underline", "strike", "ink"].includes(object.kind))
        throw Error("追加コメントの参照先がありません。");
      const sourcePdf = page.sourceId ? documents.get(page.sourceId) : undefined;
      const sourcePage = sourcePdf?.getPage(page.sourceIndex);
      const box = sourcePage?.getCropBox() ?? { x: 0, y: 0 };
      const added = addedGeometry(object, page, box);
      subtype = added.subtype;
      geometry = { rect: added.rect, coords: added.coords, ink: added.ink };
      dict = objectDictionary(generated.context, object);
      identity = object.id;
    } else {
      const resolved = resolveSourceAnnotation(model, page, row, documents);
      dict = resolved.dict;
      subtype = pdfName(dict, "Subtype") ?? "";
      identity = pdfString(dict, "NM") || row.id;
      if (subtype === "Highlight" || subtype === "Underline" || subtype === "StrikeOut") {
        const quad = dict.lookupMaybe(name("QuadPoints"), PDFArray);
        if (!quad) throw Error(`${subtype}コメントのQuadPointsがありません。`);
        geometry = { coords: numericArray(quad, `${subtype} QuadPoints`, 8, 8) };
      } else if (subtype === "Ink") {
        const inkList = dict.lookupMaybe(name("InkList"), PDFArray);
        if (!inkList || inkList.size() === 0) throw Error("インクコメントのInkListがありません。");
        const ink: number[][] = [];
        for (let i = 0; i < inkList.size(); i++) {
          const gesture = inkList.lookupMaybe(i, PDFArray);
          if (!gesture) throw Error("インクコメントのInkListが不正です。");
          ink.push(numericArray(gesture, "インク座標", 2, 2));
        }
        geometry = { ink };
      }
    }
    if (!supported.has(subtype)) throw Error(`XFDF出力に未対応のコメント形式です: ${subtype || "不明"}`);
    const baseIdentity = safeXmlText(identity);
    identity = baseIdentity;
    let suffix = 1;
    while (usedNames.has(identity)) identity = `${baseIdentity}-${pageIndex + 1}-${suffix++}`;
    usedNames.add(identity);
    output.push(annotationXml(row, dict, subtype, identity, geometry,
      row.added ? page.objects.find((object) => object.id === row.id)?.color : undefined));
  }
  const documentRef = xml(model.name);
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><f href="${documentRef}"/><fields/><annots>${output.join("")}</annots></xfdf>`;
  return new TextEncoder().encode(text);
}
