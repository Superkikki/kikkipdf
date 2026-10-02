import type { Box, EditObject, PageModel } from "../state/model";
export function directReferences(page: PageModel) {
  const references: SourceTextReference[] = [],
    seen = new Set<number>();
  for (const o of page.objects) {
    if (o.kind !== "direct-text") continue;
    const ref = o.sourceText;
    if (!ref || !page.sourceId || ref.sourceId !== page.sourceId)
      throw Error("直接編集の参照先が不正です。");
    const { additional, ...primary } = ref;
    for (const r of [
      primary,
      ...(additional ?? []).map((r) => ({ ...r, sourceId: ref.sourceId })),
    ]) {
      if (r.sourceIndex !== page.sourceIndex || seen.has(r.operatorIndex))
        throw Error("直接編集の参照先が不正です。");
      seen.add(r.operatorIndex);
      references.push(r);
    }
  }
  return references;
}
export interface TextOperationReference {
  sourceIndex: number;
  contentHash: string;
  operatorIndex: number;
  originalText: string;
}
export interface SourceTextReference extends TextOperationReference {
  sourceId: string;
  additional?: TextOperationReference[];
}
export interface DirectTextRun extends Box {
  reference: TextOperationReference;
  text: string;
  fontSize: number;
  baseline: number;
  color: string;
  opacity: number;
  font: EditObject["font"];
  bold: boolean;
  italic: boolean;
}
export interface DirectInspection {
  runs: DirectTextRun[];
  unsupported?: string;
}
