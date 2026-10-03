import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFObjectCopier,
  PDFPage,
  PDFRef,
  PDFString,
  type PDFDocument,
} from "pdf-lib";
import type { PageModel, LinkTarget, ImageAsset } from "../state/model";
import { setLinkTarget } from "../links/pdfLinks";
import { importedLinkUrl } from "../links/target";
import type { AttachmentWriter } from "../attachments/pdfAttachments";
import { rewrittenPage } from "../direct/content";
import { directReferences, directImageEdits } from "../direct/model";
import { OptionalContentSource } from "./optionalContent";
import { writeCommentMetadata } from "../annotations/commentMetadata";

const key = (name: string) => PDFName.of(name);
const text = (value: PDFObject | undefined) =>
  value instanceof PDFName
    ? value.decodeText()
    : value instanceof PDFString || value instanceof PDFHexString
      ? value.decodeText()
      : undefined;
function namedDestination(
  input: PDFDocument,
  name: string,
): PDFObject | undefined {
  const direct = input.catalog
    .lookupMaybe(key("Dests"), PDFDict)
    ?.get(key(name));
  if (direct) return input.context.lookup(direct);
  const tree = input.catalog
    .lookupMaybe(key("Names"), PDFDict)
    ?.lookupMaybe(key("Dests"), PDFDict);
  function search(
    node: PDFDict | undefined,
    depth: number,
  ): PDFObject | undefined {
    if (!node || depth > 32) return;
    const names = node.lookupMaybe(key("Names"), PDFArray);
    if (names)
      for (let i = 0; i + 1 < names.size(); i += 2)
        if (text(names.lookup(i)) === name) return names.lookup(i + 1);
    const kids = node.lookupMaybe(key("Kids"), PDFArray);
    if (kids)
      for (let i = 0; i < kids.size(); i++) {
        const found = search(kids.lookup(i, PDFDict), depth + 1);
        if (found) return found;
      }
  }
  return search(tree, 0);
}
function resolveDestination(
  input: PDFDocument,
  value: PDFObject | undefined,
): PDFArray | undefined {
  let v = value;
  for (let i = 0; i < 5; i++) {
    if (v instanceof PDFRef) v = input.context.lookup(v);
    if (v instanceof PDFArray) return v;
    if (v instanceof PDFDict) {
      v = v.get(key("D"));
      continue;
    }
    const name = text(v);
    if (name) {
      v = namedDestination(input, name);
      continue;
    }
    return;
  }
}
/** Share source resources across pages, but give every copied page/annotation its own identity.
 * Navigation is rebound after page assembly, so links cannot pull deleted page graphs back in.
 */
export class PageCopier {
  private copier: PDFObjectCopier;
  private optionalContent: OptionalContentSource;
  private exported = new Map<number, PDFPage>();
  private links: { dict: PDFDict; destination: PDFArray }[] = [];
  private editedLinks: { dict: PDFDict; target: LinkTarget }[] = [];
  constructor(
    private input: PDFDocument,
    private output: PDFDocument,
    private attachments?: AttachmentWriter,
    private images: Record<string, ImageAsset> = {},
    copier?: PDFObjectCopier,
    visibility?: Record<string, boolean>,
  ) {
    this.copier = copier ?? PDFObjectCopier.for(input.context, output.context);
    this.optionalContent = new OptionalContentSource(input, output, this.copier, visibility);
  }
  getOptionalContent() {
    return this.exported.size ? this.optionalContent.finish() : undefined;
  }
  async copy(model: PageModel): Promise<PDFPage> {
    const source = this.input.getPage(model.sourceIndex),
      node = source.node.clone();
    node.delete(key("Annots"));
    const edits = directReferences(model);
    if (edits.some((r) => r.sourceId !== model.sourceId))
      throw Error("直接編集の参照元PDFが一致しません。");
    const imageEdits = directImageEdits(model);
    const content = edits.length || imageEdits.length
      ? await rewrittenPage(source, model.sourceIndex, edits, imageEdits, this.images)
      : undefined;
    // Never copy the original content first: pdf-lib serializes orphan objects too.
    if (content) {
      node.delete(key("Contents"));
      if (content.resources) node.set(key("Resources"), content.resources);
    }
    const copied = this.copier.copy(node),
      page = PDFPage.of(
        copied,
        this.output.context.register(copied),
        this.output,
      );
    this.output.addPage(page);
    if (content)
      page.node.set(
        key("Contents"),
        this.output.context.register(this.output.context.flateStream(content.bytes)),
      );
    if (!this.exported.has(model.sourceIndex))
      this.exported.set(model.sourceIndex, page);
    const annotations = source.node.Annots();
    if (annotations)
      for (let i = 0; i < annotations.size(); i++) {
        const ref = annotations.get(i),
          original = annotations.lookup(i);
        if (
          !(original instanceof PDFDict) ||
          ["Widget", "Popup"].includes(text(original.get(key("Subtype"))) ?? "")
        )
          continue;
        const id =
          ref instanceof PDFRef
            ? `${ref.objectNumber}R${ref.generationNumber || ""}`
            : `direct-${i}`;
        const edit = model.annotationEdits?.[id];
        if (edit?.deleted) continue;
        const isAttachment =
          original.get(key("Subtype")) === key("FileAttachment");
        const fileSpec = isAttachment
          ? this.attachments?.fileSpec(original)
          : undefined;
        if (isAttachment && !fileSpec) continue;
        const safe = original.clone();
        // These references can traverse source pages or contain executable actions.
        for (const name of [
          "P",
          "Parent",
          "Popup",
          "IRT",
          "RT",
          "Dest",
          "A",
          "AA",
          "StructParent",
          "FS",
        ])
          safe.delete(key(name));
        if (edit?.text !== undefined)
          safe.set(key("Contents"), PDFHexString.fromText(edit.text));
        if (edit) writeCommentMetadata(safe, edit);
        const annotation = this.copier.copy(safe);
        if (edit?.box && text(original.get(key("Subtype"))) === "Link") {
          const box = edit.box;
          if (
            !Object.values(box).every(Number.isFinite) ||
            Math.abs(box.x) > 1e6 ||
            Math.abs(box.y) > 1e6 ||
            box.width <= 0 ||
            box.height <= 0 ||
            box.width > 100000 ||
            box.height > 100000
          ) throw Error("リンクの位置・サイズが不正です。");
          const crop = source.getCropBox();
          annotation.set(key("Rect"), this.output.context.obj([
            crop.x + box.x,
            crop.y + crop.height - box.y - box.height,
            crop.x + box.x + box.width,
            crop.y + crop.height - box.y,
          ]));
          // A source appearance or quad geometry refers to the old rectangle.
          annotation.delete(key("AP"));
          annotation.delete(key("QuadPoints"));
        }
        if (fileSpec) annotation.set(key("FS"), fileSpec);
        annotation.set(key("P"), page.ref);
        const action = original.lookupMaybe(key("A"), PDFDict);
        const destination = resolveDestination(
          this.input,
          original.get(key("Dest")) ??
            (text(action?.get(key("S"))) === "GoTo"
              ? action?.get(key("D"))
              : undefined),
        );
        if (edit?.link)
          this.editedLinks.push({ dict: annotation, target: edit.link });
        else if (destination)
          this.links.push({ dict: annotation, destination });
        else if (text(action?.get(key("S"))) === "URI") {
          const uri = importedLinkUrl(text(action?.get(key("URI"))));
          if (uri)
            annotation.set(
              key("A"),
              this.output.context.obj({
                S: "URI",
                URI: PDFString.of(uri),
              }),
            );
        }
        page.node.addAnnot(this.output.context.register(annotation));
      }
    return page;
  }
  finish(pageMap = new Map<string, PDFPage>()) {
    for (const { dict, target } of this.editedLinks)
      setLinkTarget(dict, target, pageMap);
    const pages = this.input.getPages();
    for (const { dict, destination } of this.links) {
      const first = destination.get(0),
        index =
          first instanceof PDFNumber
            ? first.asNumber()
            : first instanceof PDFRef
              ? pages.findIndex((p) => p.ref === first)
              : -1;
      const page = this.exported.get(index);
      if (!page) continue;
      const dest = this.output.context.obj([page.ref]);
      for (let i = 1; i < destination.size(); i++) {
        const value = destination.lookup(i);
        if (
          !value ||
          value instanceof PDFDict ||
          value instanceof PDFArray ||
          value instanceof PDFRef
        )
          break;
        dest.push(value.clone());
      }
      dict.set(key("Dest"), dest);
    }
  }
}
