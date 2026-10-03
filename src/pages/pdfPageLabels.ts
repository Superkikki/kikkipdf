import { PDFHexString, PDFName, PDFNumber, type PDFDocument, type PDFRef } from "pdf-lib";
import type { PageModel } from "../state/model";
import { validPageLabel } from "./labels";

/** Use explicit text labels for custom pages and compact decimal runs for
 * unlabeled pages. Output positions are independent of source PDF indices. */
export function writePageLabels(pdf: PDFDocument, pages: PageModel[]) {
  const key = PDFName.of("PageLabels");
  if (!pages.some((page) => page.label !== undefined)) {
    pdf.catalog.delete(key);
    return;
  }
  const nums = pdf.context.obj([]);
  for (let index = 0; index < pages.length; index++) {
    const label = pages[index].label;
    if (label !== undefined && (typeof label !== "string" || !validPageLabel(label)))
      throw Error("ページラベルは制御文字を含まない512文字以内にしてください。");
    if (label === undefined && index > 0 && pages[index - 1].label === undefined) continue;
    // Prefix-only runs can share a dictionary when consecutive labels match.
    if (label !== undefined && index > 0 && label === pages[index - 1].label) continue;
    const definition = label === undefined
      ? pdf.context.obj({ S: "D", St: index + 1 })
      : pdf.context.obj({ P: PDFHexString.fromText(label) });
    nums.push(PDFNumber.of(index));
    nums.push(pdf.context.register(definition));
  }
  if (nums.size() <= 128) {
    pdf.catalog.set(key, pdf.context.register(pdf.context.obj({ Nums: nums })));
    return;
  }
  // Bound each number-tree leaf/branch to 64 entries so large labeled documents
  // remain readable by consumers that expect the standard tree structure.
  interface Node { ref: PDFRef; first: number; last: number }
  let nodes: Node[] = [];
  for (let offset = 0; offset < nums.size(); offset += 128) {
    const leaf = pdf.context.obj([]);
    const end = Math.min(nums.size(), offset + 128);
    for (let i = offset; i < end; i++) leaf.push(nums.get(i));
    const first = nums.lookup(offset, PDFNumber).asNumber();
    const last = nums.lookup(end - 2, PDFNumber).asNumber();
    nodes.push({ first, last, ref: pdf.context.register(pdf.context.obj({ Nums: leaf, Limits: [first, last] })) });
  }
  while (nodes.length > 64) {
    const parents: Node[] = [];
    for (let offset = 0; offset < nodes.length; offset += 64) {
      const children = nodes.slice(offset, offset + 64);
      const first = children[0].first, last = children[children.length - 1].last;
      parents.push({ first, last, ref: pdf.context.register(pdf.context.obj({
        Kids: children.map((child) => child.ref), Limits: [first, last],
      })) });
    }
    nodes = parents;
  }
  pdf.catalog.set(key, pdf.context.register(pdf.context.obj({ Kids: nodes.map((node) => node.ref) })));
}
