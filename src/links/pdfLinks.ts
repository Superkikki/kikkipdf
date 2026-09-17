import {
  PDFDict,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFDocument,
  type PDFPage,
} from "pdf-lib";
import type { DocumentModel, LinkTarget } from "../state/model";
import { validatedLinkUrl } from "./target";
export function setLinkTarget(
  dict: PDFDict,
  target: LinkTarget,
  pages: Map<string, PDFPage>,
): boolean {
  dict.delete(PDFName.of("Dest"));
  dict.delete(PDFName.of("A"));
  if (target.kind === "page") {
    const page = pages.get(target.pageId);
    if (!page) return false;
    dict.set(PDFName.of("Dest"), dict.context.obj([page.ref, "Fit"]));
  } else
    dict.set(
      PDFName.of("A"),
      dict.context.obj({
        S: "URI",
        URI: PDFString.of(validatedLinkUrl(target.url)),
      }),
    );
  return true;
}
export function writeLinks(
  pdf: PDFDocument,
  model: DocumentModel,
  pages: Map<string, PDFPage>,
) {
  for (const p of model.pages) {
    const page = pages.get(p.id);
    if (!page) continue;
    const base = page.getMediaBox();
    // Model coordinates are relative to the original CropBox, not a newly applied crop.
    const sourceBox = p.crop
      ? {
          x: page.getCropBox().x - p.crop.x,
          y: page.getCropBox().y - p.height + p.crop.y + p.crop.height,
        }
      : page.getCropBox();
    const origin = Number.isFinite(sourceBox.x) ? sourceBox : base;
    for (const o of p.objects.filter((o) => o.kind === "link")) {
      if (!o.link) throw Error("リンクの移動先を指定してください。");
      const dict = pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        P: page.ref,
        Rect: [
          origin.x + o.x,
          origin.y + p.height - o.y - o.height,
          origin.x + o.x + o.width,
          origin.y + p.height - o.y,
        ],
        Border: [0, 0, 0],
        F: 4,
        H: "I",
        NM: PDFHexString.fromText(o.id),
      });
      if (setLinkTarget(dict, o.link, pages))
        page.node.addAnnot(pdf.context.register(dict));
    }
  }
}
