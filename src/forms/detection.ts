import type { Box, DocumentModel, FormFieldModel } from "../state/model";
import { uid } from "../state/model";
import { change } from "../commands/document";
import type { FormDescriptor } from "../export/engine";
export interface FormCandidate extends Box { kind: "text" | "checkbox"; name: string }
export function overlaps(a: Box, b: Box) {
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / Math.min(a.width * a.height, b.width * b.height) > 0.45;
}
/** Find empty, closed, axis-aligned rectangles. Pixel coordinates are normalized to page points. */
export function detectFormRectangles(data: Uint8ClampedArray, width: number, height: number, pageWidth: number, pageHeight: number): FormCandidate[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 3_000_000 || data.length !== width * height * 4 || ![pageWidth, pageHeight].every(n => Number.isFinite(n) && n > 0)) throw Error("検出用画像のサイズが不正です。");
  const sx = width / pageWidth, sy = height / pageHeight;
  const dark = (x: number, y: number) => { const i = (y * width + x) * 4; return data[i + 3] > 128 && (data[i] + data[i + 1] + data[i + 2]) / 3 < 200; };
  const rows: { x: number; y: number; end: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!dark(x, y)) continue;
      const start = x; let last = x;
      while (++x < width) { if (dark(x, y)) last = x; else if (x - last > 1) break; }
      if (last - start >= 8 * sx && last - start <= 500 * sx && !rows.slice(-30).some(row => y - row.y <= 2 && Math.abs(row.x - start) <= 2 && Math.abs(row.end - last) <= 2)) rows.push({ x: start, y, end: last });
      if (rows.length > 10000) throw Error("罫線が多すぎます。検出するページを変更してください。");
    }
  }
  const found: FormCandidate[] = []; let comparisons = 0, inspected = 0;
  for (let i = 0; i < rows.length; i++) {
    const top = rows[i];
    for (let j = i + 1; j < rows.length; j++) {
      if (++comparisons > 100000) throw Error("罫線が多すぎます。検出するページを変更してください。");
      const bottom = rows[j], h = (bottom.y - top.y) / sy, w = (top.end - top.x) / sx;
      if (h > 100) break;
      if (h < 8 || Math.abs(bottom.x - top.x) > 3 || Math.abs(bottom.end - top.end) > 3) continue;
      inspected += (bottom.y - top.y) * (top.end - top.x);
      if (inspected > 30000000) throw Error("枠の候補が多すぎます。検出するページを変更してください。");
      const inset = Math.max(3, Math.ceil(2.5 * Math.max(sx, sy)));
      let edges = 0, ink = 0, area = 0;
      for (let y = top.y + 2; y < bottom.y - 1; y++) {
        if ([-1, 0, 1, 2].some(dx => dark(Math.max(0, Math.min(width - 1, top.x + dx)), y)) && [-2, -1, 0, 1].some(dx => dark(Math.max(0, Math.min(width - 1, top.end + dx)), y))) edges++;
        if (y >= top.y + inset && y <= bottom.y - inset) for (let x = top.x + inset; x <= top.end - inset; x++) { area++; if (dark(x, y)) ink++; }
      }
      if (edges < (bottom.y - top.y - 3) * 0.75 || area === 0 || ink / area > 0.035) continue;
      const checkbox = w >= 8 && w <= 30 && h <= 30 && w / h > 0.75 && w / h < 1.33;
      if (!checkbox && (w < 40 || h < 12 || w / h < 1.5)) continue;
      const box = { x: top.x / sx, y: top.y / sy, width: w, height: h };
      if (!found.some(candidate => overlaps(candidate, box))) found.push({ ...box, kind: checkbox ? "checkbox" : "text", name: `Detected_${found.length + 1}` });
      if (found.length >= 200) return found;
      break;
    }
  }
  return found.sort((a, b) => a.y - b.y || a.x - b.x);
}
export function occupiedFormBoxes(model: DocumentModel, pageId: string, imported: FormDescriptor[]): Box[] {
  const page = model.pages.find(page => page.id === pageId);
  if (!page) throw Error("ページがありません。");
  return [...(model.formFields ?? []).filter(field => field.pageId === pageId), ...imported.filter(field => field.sourceId === page.sourceId && !model.importedFormEdits?.[field.key]?.deleted).flatMap(field => field.widgets.filter(widget => widget.pageIndex === page.sourceIndex).map(widget => page.formWidgetEdits?.[widget.id] ?? widget))];
}
export function addDetectedFields(snapshot: DocumentModel, pageId: string, candidates: FormCandidate[], imported: FormDescriptor[]) {
  const captured = structuredClone(candidates), ids = captured.map(() => uid());
  return change("検出したフォーム欄を追加", model => {
    if (model !== snapshot) throw Error("文書が変更されました。もう一度検出してください。");
    const page = model.pages.find(page => page.id === pageId);
    if (!page || !captured.length || captured.length > 200 || (model.formFields?.length ?? 0) + captured.length > 10000) throw Error("追加するフォーム欄を1〜200件選択してください。総数は10000件までです。");
    const occupied = occupiedFormBoxes(model, pageId, imported), names = new Set([...(model.formFields ?? []).map(field => field.name), ...imported.map(field => model.importedFormEdits?.[field.key]?.name ?? field.name)]);
    const fields: FormFieldModel[] = captured.map((candidate, index) => {
      if (![candidate.x, candidate.y, candidate.width, candidate.height].every(Number.isFinite) || candidate.x < 0 || candidate.y < 0 || candidate.width < 1 || candidate.height < 1 || candidate.x + candidate.width > page.width + 1 || candidate.y + candidate.height > page.height + 1 || !["text", "checkbox"].includes(candidate.kind) || !candidate.name.trim() || candidate.name.length > 500) throw Error("フォーム欄の名前と配置を確認してください。");
      if (occupied.some(box => overlaps(box, candidate))) throw Error("既存または追加予定のフォーム欄と重なっています。");
      occupied.push(candidate);
      const base = candidate.name.trim(); let name = base, n = 2;
      while (names.has(name)) name = `${base.slice(0, 480)}_${n++}`;
      names.add(name);
      return { ...candidate, name, id: ids[index], pageId, value: candidate.kind === "checkbox" ? false : "", options: [], fontSize: 12, required: false, readOnly: false, multiline: candidate.height >= 45 };
    });
    return { ...model, formFields: [...(model.formFields ?? []), ...fields] };
  });
}
