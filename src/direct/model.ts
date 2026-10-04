import type { Box, EditObject, PageModel } from "../state/model";
export const textReferenceKey = (r: Pick<TextOperationReference, "formPath" | "operatorIndex">) =>
  [...(r.formPath ?? []), r.operatorIndex].join("/");
export function directReferences(page: PageModel) {
  const references: SourceTextReference[] = [],
    seen = new Set<string>();
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
      if (r.sourceIndex !== page.sourceIndex || seen.has(textReferenceKey(r)))
        throw Error("直接編集の参照先が不正です。");
      seen.add(textReferenceKey(r));
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
  /** Do operator indices from the page to this particular Form invocation. */
  formPath?: number[];
}
export interface SourceTextReference extends TextOperationReference {
  sourceId: string;
  additional?: TextOperationReference[];
}
export interface DirectTextRun extends Box {
  reference: TextOperationReference;
  text: string;
  /** Verified fallback used by PDF.js text extraction for legacy glyphs. */
  extractedText?: string;
  fontSize: number;
  baseline: number;
  writingMode?: "vertical";
  flowX?: number;
  flowTop?: number;
  flowEnd?: number;
  color: string;
  opacity: number;
  font: EditObject["font"];
  bold: boolean;
  italic: boolean;
}
export interface DirectInspection {
  runs: DirectTextRun[];
  images?: DirectImageRun[];
  unsupported?: string;
}
export interface SourceImageReference extends Omit<TextOperationReference, "originalText"> {
  sourceId: string;
  resourceName: string;
  originalBox: Box;
  bounds?: Box[];
}
export interface DirectImageRun extends Box {
  reference: Omit<SourceImageReference, "sourceId" | "originalBox">;
  bounds: Box[];
}
export interface DirectImageEdit extends Box {
  reference: SourceImageReference;
  deleted: boolean;
  imageId?: string;
}
export function directImageEdits(page: PageModel): DirectImageEdit[] {
  const seen = new Set<string>();
  return page.objects.filter(o => o.kind === "direct-image").map(o => {
    const ref = o.sourceImage;
    if (!ref || !page.sourceId || ref.sourceId !== page.sourceId || ref.sourceIndex !== page.sourceIndex ||
        seen.has(textReferenceKey(ref)) || o.rotation !== 0 || o.opacity !== 1)
      throw Error("既存画像の参照先・変形が不正です。");
    seen.add(textReferenceKey(ref));
    return { reference: ref, x: o.x, y: o.y, width: o.width, height: o.height, deleted: !!o.imageDeleted, ...(o.imageId ? { imageId: o.imageId } : {}) };
  });
}
