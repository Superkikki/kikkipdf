import { change } from "../commands/document";
import { newObject, type DocumentModel, type PageModel } from "../state/model";
import { parseRange } from "./ranges";

export interface BatesOptions {
  range: string;
  prefix: string;
  suffix: string;
  start: number;
  digits: number;
  position: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
  margin: number;
  fontSize: number;
  color: string;
}
export interface BatesItem { pageIndex: number; pageId: string; text: string }

export function planBates(model: DocumentModel, options: BatesOptions): BatesItem[] {
  const { prefix, suffix, start, digits, position, margin, fontSize, color } = options;
  if (prefix.length > 64 || suffix.length > 64 || [...prefix, ...suffix].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw Error("接頭辞・接尾辞はそれぞれ64文字以内の1行で入力してください。");
  if (!Number.isSafeInteger(start) || start < 0 || start > 999_999_999_999 || !Number.isInteger(digits) || digits < 1 || digits > 12) throw Error("開始番号は0〜999999999999、桁数は1〜12で指定してください。");
  if (!Number.isFinite(margin) || margin < 6 || margin > 144 || !Number.isFinite(fontSize) || fontSize < 6 || fontSize > 36 || !/^#[0-9a-f]{6}$/i.test(color)) throw Error("余白は6〜144pt、文字サイズは6〜36ptで指定してください。");
  if (!["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"].includes(position)) throw Error("番号の配置が不正です。");
  const indices = parseRange(options.range, model.pages.length).sort((a, b) => a - b);
  if (!indices.length || indices.length > 10000 || start + indices.length - 1 > 999_999_999_999) throw Error("ページ数または終了番号が上限を超えています。");
  return indices.map((pageIndex, i) => {
    const value = start + i;
    if (String(value).length > digits) throw Error("番号が指定した桁数を超えます。桁数を増やしてください。");
    const page = model.pages[pageIndex], crop = page.crop ?? { x: 0, y: 0, width: page.width, height: page.height };
    const w = page.rotation % 180 ? crop.height : crop.width, h = page.rotation % 180 ? crop.width : crop.height;
    if (w - margin * 2 < 20 || h - margin * 2 < fontSize + 8) throw Error(`${pageIndex + 1}ページの表示領域が小さすぎます。余白や文字サイズを減らしてください。`);
    if (![0, 90, 180, 270].includes(page.rotation)) throw Error("ページの回転が不正です。");
    return { pageIndex, pageId: page.id, text: `${prefix}${String(value).padStart(digits, "0")}${suffix}` };
  });
}

/** Coordinates are stored before page rotation, while placement is chosen in the visible page. */
export function batesObject(page: PageModel, text: string, options: BatesOptions) {
  const crop = page.crop ?? { x: 0, y: 0, width: page.width, height: page.height };
  const w = page.rotation % 180 ? crop.height : crop.width, h = page.rotation % 180 ? crop.width : crop.height;
  const height = options.fontSize + 8, x = options.margin;
  const y = options.position.startsWith("top") ? options.margin : h - options.margin - height;
  const bottom = y + height;
  let u = x, v = bottom;
  if (page.rotation === 90) { u = bottom; v = crop.height - x; }
  else if (page.rotation === 180) { u = crop.width - x; v = crop.height - bottom; }
  else if (page.rotation === 270) { u = crop.width - bottom; v = x; }
  return { ...newObject("text", crop.x + u, crop.y + v - height), text, width: w - options.margin * 2, height,
    fontSize: options.fontSize, font: /[^\x20-\x7e]/.test(text) ? "japanese" as const : "sans" as const, color: options.color, rotation: -page.rotation, wrap: false,
    align: options.position.endsWith("left") ? "left" as const : options.position.endsWith("right") ? "right" as const : "center" as const };
}

export function addBatesNumbers(snapshot: DocumentModel, options: BatesOptions) {
  const plan = planBates(snapshot, options), objects = new Map(plan.map(item => [item.pageId, batesObject(snapshot.pages[item.pageIndex], item.text, options)]));
  if (objects.size !== plan.length) throw Error("ページIDが重複しています。");
  return change("ベイツ番号を追加", model => {
    if (model !== snapshot) throw Error("文書が変更されました。画面を開き直してください。");
    return { ...model, pages: model.pages.map(page => {
      const object = objects.get(page.id); return object ? { ...page, objects: [...page.objects, object] } : page;
    }) };
  });
}
