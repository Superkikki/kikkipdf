import { newObject, type Box, type PageModel } from "../state/model";
import type { DirectInspection } from "./model";
import { directReferences } from "./model";
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
    if (
      Math.abs(run.x - box.x) > Math.max(3, run.fontSize * 0.3) ||
      run.baseline < box.y - run.fontSize * 0.3 ||
      run.baseline > box.y + box.height + run.fontSize * 0.3
    )
      continue;
    const group = [run];
    let joined = normalized(run.text);
    for (
      let j = i + 1;
      joined !== value &&
      value.startsWith(joined) &&
      j < inspection.runs.length;
      j++
    ) {
      const next = inspection.runs[j],
        previous = group.at(-1)!;
      if (
        Math.abs(next.baseline - run.baseline) > 0.1 ||
        Math.abs(next.fontSize - run.fontSize) > 0.1 ||
        next.font !== run.font ||
        next.bold !== run.bold ||
        next.italic !== run.italic ||
        Math.abs(next.x - (previous.x + previous.width)) >
          Math.max(3, run.fontSize * 0.3)
      )
        break;
      group.push(next);
      joined += normalized(next.text);
    }
    if (joined === value) candidates.push(group);
  }
  if (candidates.length !== 1 || !page.sourceId)
    throw Error(
      inspection.unsupported ??
        "この文字領域は直接編集できません。曖昧な文字領域やForm XObject内の文字は対象外です。",
    );
  const group = candidates[0],
    run = group[0];
  const edited = new Set(directReferences(page).map((r) => r.operatorIndex));
  if (group.some((r) => edited.has(r.reference.operatorIndex)))
    throw Error(
      "この文字は既に編集対象です。選択ツールで編集オブジェクトを選んでください。",
    );
  return {
    ...newObject("direct-text", run.x, run.y),
    width: Math.max(1, box.width),
    height: run.height,
    text: selectedText,
    fontSize: run.fontSize,
    font: run.font,
    bold: run.bold,
    italic: run.italic,
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
