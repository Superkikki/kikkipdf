import { PDFArray, PDFDict, PDFName, PDFRef, type PDFDocument, type PDFObject } from "pdf-lib";

export type OptionalContentMembership =
  | { type: "OCG"; id: string }
  | { type: "OCMD"; ids: string[]; policy: string; expression?: unknown[] };
const refId = (ref: PDFRef) => `${ref.objectNumber}R${ref.generationNumber || ""}`;

export function optionalContentMembership(pdf: PDFDocument, value: PDFObject | undefined): OptionalContentMembership | undefined {
  const dict = pdf.context.lookup(value);
  if (!(dict instanceof PDFDict)) return;
  if (dict.get(PDFName.of("Type")) === PDFName.of("OCG") && value instanceof PDFRef)
    return { type: "OCG", id: refId(value) };
  if (dict.get(PDFName.of("Type")) !== PDFName.of("OCMD")) return;
  const groups = dict.get(PDFName.of("OCGs"));
  const resolved = pdf.context.lookup(groups);
  const refs = resolved instanceof PDFArray ? resolved.asArray() : groups ? [groups] : [];
  const policy = dict.get(PDFName.of("P"));
  function expression(value: PDFObject | undefined, depth: number): unknown[] | undefined {
    if (depth > 32) throw Error("レイヤーの表示条件が複雑すぎます。");
    const array = pdf.context.lookup(value);
    if (!(array instanceof PDFArray)) return;
    return array.asArray().map((item) => item instanceof PDFRef && !(pdf.context.lookup(item) instanceof PDFArray)
      ? refId(item) : item instanceof PDFName ? item.decodeText() : expression(item, depth + 1));
  }
  return { type: "OCMD", ids: refs.filter((ref): ref is PDFRef => ref instanceof PDFRef).map(refId),
    policy: policy instanceof PDFName ? policy.decodeText() : "AnyOn",
    expression: expression(dict.get(PDFName.of("VE")), 0) };
}
