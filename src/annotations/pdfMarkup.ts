import { PDFHexString, type PDFDocument, type PDFPage } from "pdf-lib";
import type { EditObject } from "../state/model";
/** Standard PDF markup annotations with explicit appearance streams for consistent viewers. */
export function writeMarkup(
  pdf: PDFDocument,
  page: PDFPage,
  o: EditObject,
  left: number,
  top: number,
) {
  const x = left + o.x,
    y = top - o.y - o.height,
    w = o.width,
    h = o.height,
    m = Math.max(2, o.strokeWidth);
  const c = [1, 3, 5].map((i) => parseInt(o.color.slice(i, i + 2), 16) / 255);
  const fmt = (n: number) => Number(n.toFixed(4));
  const path: string[] = [
    "q",
    "/GS gs",
    `${c.map(fmt).join(" ")} RG`,
    `${c.map(fmt).join(" ")} rg`,
    `${fmt(o.strokeWidth)} w`,
    "1 J 1 j",
    `1 0 0 1 ${fmt(m)} ${fmt(m)} cm`,
  ];
  if (o.kind === "highlight") path.push(`0 0 ${fmt(w)} ${fmt(h)} re f`);
  else if (o.kind === "ink") {
    for (const [i, p] of (o.points ?? []).entries())
      path.push(`${fmt(p.x)} ${fmt(h - p.y)} ${i ? "l" : "m"}`);
    path.push("S");
  } else {
    const lineY = o.kind === "strike" ? h / 2 : 0;
    path.push(`0 ${fmt(lineY)} m ${fmt(w)} ${fmt(lineY)} l S`);
  }
  path.push("Q");
  const context = pdf.context;
  const appearance = context.register(
    context.flateStream(path.join("\n"), {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, w + 2 * m, h + 2 * m],
      Resources: {
        ExtGState: {
          GS: {
            Type: "ExtGState",
            CA: o.opacity,
            ca: o.opacity,
            BM: o.kind === "highlight" ? "Multiply" : "Normal",
          },
        },
      },
    }),
  );
  const annotation = context.obj({
    Type: "Annot",
    Subtype:
      o.kind === "highlight"
        ? "Highlight"
        : o.kind === "underline"
          ? "Underline"
          : o.kind === "strike"
            ? "StrikeOut"
            : "Ink",
    Rect: [x - m, y - m, x + w + m, y + h + m],
    F: 4,
    C: c,
    CA: o.opacity,
    BS: { W: o.strokeWidth, S: "S" },
    NM: PDFHexString.fromText(o.id),
    Contents: PDFHexString.fromText(o.text ?? ""),
    T: PDFHexString.fromText(o.author ?? ""),
    P: page.ref,
    AP: { N: appearance },
    ...(o.kind === "ink"
      ? { InkList: [(o.points ?? []).flatMap((p) => [x + p.x, y + h - p.y])] }
      : { QuadPoints: [x, y + h, x + w, y + h, x, y, x + w, y] }),
  });
  page.node.addAnnot(context.register(annotation));
}
