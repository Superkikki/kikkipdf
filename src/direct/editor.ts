import { newObject, type Box, type PageModel } from "../state/model";
import type { DirectInspection } from "./model";
import { directReferences, textReferenceKey } from "./model";
const normalized = (s: string) => s.normalize("NFKC").replace(/\s/g, "");
/** Require both decoded text and position. Duplicate/ambiguous runs are refused. */
export function directTextObject(
  inspection: DirectInspection,
  page: PageModel,
  selectedText: string,
  box: Box,
) {
  const candidates: (typeof inspection.runs)[] = [];
  const value = normalized(selectedText);
  for (const [i, run] of inspection.runs.entries()) {
    const rotated = !!run.rotation;
    const tolerance = Math.max(3, run.fontSize * 0.6);
    const matches = rotated
      ? run.baselineX! >= box.x - tolerance && run.baselineX! <= box.x + box.width + tolerance &&
        run.baseline >= box.y - tolerance && run.baseline <= box.y + box.height + tolerance
      : run.writingMode === "vertical"
      ? Math.abs((run.flowX ?? run.x) - (box.x + box.width / 2)) <= run.fontSize * 1.25 &&
        Math.abs((run.flowTop ?? run.y) - box.y) <= run.fontSize * 0.5
      : Math.abs(run.x - box.x) <= Math.max(3, run.fontSize * 0.3) &&
        run.baseline >= box.y - run.fontSize * 0.3 && run.baseline <= box.y + box.height + run.fontSize * 0.3;
    if (!matches) continue;
    const group = [run];
    let joined = normalized(run.extractedText ?? run.text), actual = normalized(run.text);
    for (
      let j = i + 1;
      joined !== value && actual !== value &&
      (value.startsWith(joined) || value.startsWith(actual)) &&
      j < inspection.runs.length;
      j++
    ) {
      const next = inspection.runs[j],
        previous = group.at(-1)!;
      if (
        next.writingMode !== run.writingMode ||
        Math.abs((next.rotation ?? 0) - (run.rotation ?? 0)) > 0.001 ||
        (run.writingMode === "vertical"
          ? Math.abs((next.flowX ?? 0) - (run.flowX ?? 0)) > 0.1 || Math.abs((next.flowTop ?? 0) - (previous.flowEnd ?? 0)) > 0.1
          : rotated
            ? Math.hypot(next.baselineX! - previous.baselineX! - Math.cos(run.rotation! * Math.PI / 180) * previous.advanceWidth!,
                next.baseline - previous.baseline - Math.sin(run.rotation! * Math.PI / 180) * previous.advanceWidth!) > Math.max(3, run.fontSize * 0.3)
            : Math.abs(next.baseline - run.baseline) > 0.1) ||
        Math.abs(next.fontSize - run.fontSize) > 0.1 ||
        next.font !== run.font ||
        next.bold !== run.bold ||
        next.italic !== run.italic ||
        next.textStrokeWidth !== run.textStrokeWidth ||
        next.textStrokeColor !== run.textStrokeColor || next.textOutlineOnly !== run.textOutlineOnly ||
        next.color !== run.color || next.opacity !== run.opacity ||
        (!rotated && run.writingMode !== "vertical" && Math.abs(next.x - (previous.x + previous.width)) >
          Math.max(3, run.fontSize * 0.3))
      )
        break;
      group.push(next);
      joined += normalized(next.extractedText ?? next.text);
      actual += normalized(next.text);
    }
    if (joined === value || actual === value) {
      if (rotated) {
        const left = Math.min(...group.map(r => r.x)), top = Math.min(...group.map(r => r.y));
        const right = Math.max(...group.map(r => r.x + r.width)), bottom = Math.max(...group.map(r => r.y + r.height));
        if (Math.abs(left - box.x) > tolerance || Math.abs(top - box.y) > tolerance ||
            Math.abs(right - box.x - box.width) > tolerance || Math.abs(bottom - box.y - box.height) > tolerance) continue;
      }
      candidates.push(group);
    }
  }
  if (candidates.length !== 1 || !page.sourceId)
    throw Error(
      inspection.unsupported ??
        "この文字領域は直接編集できません。曖昧な文字領域や特殊な描画は対象外です。",
    );
  const group = candidates[0],
    run = group[0];
  const edited = new Set(directReferences(page).map(textReferenceKey));
  if (group.some((r) => edited.has(textReferenceKey(r.reference))))
    throw Error(
      "この文字は既に編集対象です。選択ツールで編集オブジェクトを選んでください。",
    );
  const radians = (run.rotation ?? 0) * Math.PI / 180;
  const height = run.fontSize * 1.25, descender = height - run.fontSize;
  // TextShape and export rotate around the lower-left corner. Place that pivot
  // so the first baseline stays at the original origin at every angle.
  const rotatedX = run.baselineX! - Math.sin(radians) * descender;
  const rotatedY = run.baseline + Math.cos(radians) * descender - height;
  return {
    ...newObject("direct-text", run.writingMode === "vertical" ? run.flowX! - run.fontSize / 2 : run.rotation ? rotatedX : run.x,
      run.writingMode === "vertical" ? run.flowTop! : run.rotation ? rotatedY : run.y),
    ...(run.rotation ? { rotation: run.rotation } : {}),
    ...(run.writingMode ? { writingMode: run.writingMode } : {}),
    width: run.writingMode === "vertical" ? run.fontSize : run.rotation
      ? Math.max(1, group.reduce((sum, r) => sum + r.advanceWidth!, 0)) : Math.max(1, box.width),
    height: run.writingMode === "vertical" ? Math.max(run.fontSize, (group.at(-1)!.flowEnd ?? 0) - run.flowTop!) : run.rotation ? height : run.height,
    text: group.some(r => r.extractedText !== undefined) ? group.map(r => r.editableText ?? r.text).join("") : selectedText,
    fontSize: run.fontSize,
    ...(run.textStrokeWidth ? { textStrokeWidth: run.textStrokeWidth,
      textStrokeColor: run.textStrokeColor, ...(run.textOutlineOnly ? { textOutlineOnly: true } : {}) } : {}),
    font: run.font,
    bold: run.writingMode === "vertical" ? false : run.bold,
    italic: run.writingMode === "vertical" ? false : run.italic,
    color: run.color,
    opacity: run.opacity,
    wrap: false,
    lineHeight: 1.25,
    sourceText: {
      ...run.reference,
      sourceId: page.sourceId,
      ...(group.length > 1
        ? { additional: group.slice(1).map((r) => r.reference) }
        : {}),
    },
  };
}
