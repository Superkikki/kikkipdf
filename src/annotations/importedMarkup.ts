import { z } from "zod";
import { change, editPage } from "../commands/document";
import type { ImportedMarkup } from "../state/model";

export type { ImportedMarkup } from "../state/model";
const coordinate = z.number().finite().min(-1e6).max(1e6);
const point = z.object({ x: coordinate, y: coordinate });
export const importedMarkupSchema: z.ZodType<ImportedMarkup> = z.object({
  id: z.string().min(1).max(200).refine(value => !["__proto__", "prototype", "constructor"].includes(value)),
  subtype: z.enum(["Text", "Highlight", "Underline", "StrikeOut", "Ink"]),
  x: coordinate, y: coordinate,
  width: z.number().finite().positive().max(100000),
  height: z.number().finite().positive().max(100000),
  name: z.string().max(10000).optional(),
  text: z.string().max(1_000_000), author: z.string().max(10000),
  reviewStatus: z.enum(["None", "Accepted", "Rejected", "Cancelled", "Completed"]),
  color: z.string().regex(/^#[\da-f]{6}$/i).nullable(),
  opacity: z.number().finite().min(0).max(1),
  strokeWidth: z.number().finite().min(0).max(1000),
  quadPoints: z.array(point).min(4).max(100000).refine(points => points.length % 4 === 0).optional(),
  gestures: z.array(z.array(point).min(1).max(100000)).min(1).max(100000)
    .refine(gestures => gestures.reduce((count, gesture) => count + gesture.length, 0) <= 100000).optional(),
  icon: z.string().max(1000).optional(),
  date: z.string().max(1000).optional(), creationDate: z.string().max(1000).optional(),
  subject: z.string().max(10000).optional(), flags: z.number().int().min(0).max(1023).optional(),
}).refine(markup => markup.subtype === "Text"
  ? markup.quadPoints === undefined && markup.gestures === undefined
  : markup.subtype === "Ink"
    ? markup.gestures !== undefined && markup.quadPoints === undefined
    : markup.quadPoints !== undefined && markup.gestures === undefined,
{ message: "注釈の種類と座標が一致しません。" });

export const importedMarkupsSchema = z.array(importedMarkupSchema).max(5000).refine(markups => {
  const ids = new Set(markups.map(markup => markup.id));
  const points = markups.reduce((sum, markup) => sum + (markup.quadPoints?.length ?? 0) +
    (markup.gestures?.reduce((count, gesture) => count + gesture.length, 0) ?? 0), 0);
  return ids.size === markups.length && points <= 100000;
}, { message: "取り込んだ注釈のID重複または座標数の上限超過があります。" });

export function addImportedMarkups(entries: readonly { pageId: string; markup: ImportedMarkup }[], label = "XFDFコメントを読み込み") {
  if (entries.length > 5000) throw Error("一度に読み込める注釈は5000件までです。");
  const captured = entries.map(entry => ({ pageId: entry.pageId, markup: importedMarkupSchema.parse(entry.markup) }));
  return change(label, document => {
    const groups = new Map<string, ImportedMarkup[]>();
    const pages = new Set(document.pages.map(page => page.id));
    for (const entry of captured) {
      if (!pages.has(entry.pageId)) throw Error("注釈の読み込み先ページが見つかりません。");
      const group = groups.get(entry.pageId) ?? [];
      group.push(entry.markup); groups.set(entry.pageId, group);
    }
    return { ...document, pages: document.pages.map(page => {
      const incoming = groups.get(page.id);
      return incoming ? { ...page, importedMarkups: importedMarkupsSchema.parse([...(page.importedMarkups ?? []), ...incoming]) } : page;
    }) };
  });
}

export function updateImportedMarkup(pageId: string, id: string, patch: Partial<ImportedMarkup>) {
  const captured = structuredClone(patch);
  return editPage(pageId, page => ({ ...page, importedMarkups: importedMarkupsSchema.parse((page.importedMarkups ?? []).map(markup =>
    markup.id === id ? importedMarkupSchema.parse({ ...markup, ...captured, id: markup.id }) : markup,
  )) }), "取り込んだ注釈を編集");
}

export function removeImportedMarkup(pageId: string, id: string) {
  return editPage(pageId, page => ({ ...page, importedMarkups: (page.importedMarkups ?? []).filter(markup => markup.id !== id) }),
    "取り込んだ注釈を削除");
}
