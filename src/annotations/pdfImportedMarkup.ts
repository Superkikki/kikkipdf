import { PDFHexString, type PDFDocument, type PDFPage } from "pdf-lib";
import type { ImportedMarkup, Point } from "../state/model";
import { importedMarkupSchema } from "./importedMarkup";
import { writeCommentMetadata } from "./commentMetadata";

export function importedMarkupPdfGeometry(markup: ImportedMarkup, height: number, origin: Point = { x: 0, y: 0 }) {
  const convert = (point: Point): Point => ({ x: origin.x + point.x, y: origin.y + height - point.y });
  const topLeft = convert(markup), bottomRight = convert({ x: markup.x + markup.width, y: markup.y + markup.height });
  return {
    rect: [topLeft.x, bottomRight.y, bottomRight.x, topLeft.y],
    quadPoints: markup.quadPoints?.flatMap(point => { const p = convert(point); return [p.x, p.y]; }),
    inkList: markup.gestures?.map(gesture => gesture.flatMap(point => { const p = convert(point); return [p.x, p.y]; })),
  };
}

/** Retain imported quad/gesture geometry and generate its PDF appearance independently of source bytes. */
export function writeImportedMarkup(pdf: PDFDocument, page: PDFPage, value: ImportedMarkup, height: number, origin: Point) {
  const markup = importedMarkupSchema.parse(value);
  const geometry = importedMarkupPdfGeometry(markup, height, origin);
  const color = markup.color ?? (markup.subtype === "Text" || markup.subtype === "Highlight" ? "#ffce32" : "#263445");
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
  const fmt = (number: number) => Number(number.toFixed(6));
  const commands = ["q", "/GS gs", `${rgb.map(fmt).join(" ")} RG`, `${rgb.map(fmt).join(" ")} rg`,
    `${fmt(markup.strokeWidth)} w`, "1 J 1 j"];
  const point = (p: Point) => ({ x: p.x - markup.x, y: markup.y + markup.height - p.y });
  const pair = (p: Point) => `${fmt(p.x)} ${fmt(p.y)}`;
  if (markup.color === null) {
    // An explicit empty PDF color array retains a transparent annotation.
  } else if (markup.subtype === "Text") {
    commands.push(`0 0 ${fmt(markup.width)} ${fmt(markup.height)} re f`, "0.35 0.3 0.15 RG", "0.7 w",
      `${fmt(markup.width * 0.2)} ${fmt(markup.height * 0.65)} m ${fmt(markup.width * 0.8)} ${fmt(markup.height * 0.65)} l S`,
      `${fmt(markup.width * 0.2)} ${fmt(markup.height * 0.4)} m ${fmt(markup.width * 0.65)} ${fmt(markup.height * 0.4)} l S`);
  } else if (markup.subtype === "Ink") {
    for (const gesture of markup.gestures ?? []) {
      if (gesture.length === 1) {
        const center = point(gesture[0]), radius = Math.max(markup.strokeWidth / 2, 0.5), k = radius * 0.5522847498;
        const { x, y } = center;
        commands.push(`${fmt(x + radius)} ${fmt(y)} m`,
          `${fmt(x + radius)} ${fmt(y + k)} ${fmt(x + k)} ${fmt(y + radius)} ${fmt(x)} ${fmt(y + radius)} c`,
          `${fmt(x - k)} ${fmt(y + radius)} ${fmt(x - radius)} ${fmt(y + k)} ${fmt(x - radius)} ${fmt(y)} c`,
          `${fmt(x - radius)} ${fmt(y - k)} ${fmt(x - k)} ${fmt(y - radius)} ${fmt(x)} ${fmt(y - radius)} c`,
          `${fmt(x + k)} ${fmt(y - radius)} ${fmt(x + radius)} ${fmt(y - k)} ${fmt(x + radius)} ${fmt(y)} c f`);
      } else {
        gesture.forEach((p, index) => commands.push(`${pair(point(p))} ${index ? "l" : "m"}`));
        commands.push("S");
      }
    }
  } else {
    const quads = markup.quadPoints ?? [];
    for (let index = 0; index < quads.length; index += 4) {
      const [a, b, c, d] = quads.slice(index, index + 4).map(point);
      if (markup.subtype === "Highlight") commands.push(`${pair(a)} m ${pair(b)} l ${pair(d)} l ${pair(c)} l h f`);
      else {
        const start = markup.subtype === "Underline" ? c : { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
        const end = markup.subtype === "Underline" ? d : { x: (b.x + d.x) / 2, y: (b.y + d.y) / 2 };
        commands.push(`${pair(start)} m ${pair(end)} l S`);
      }
    }
  }
  commands.push("Q");
  const context = pdf.context;
  const appearance = context.register(context.flateStream(commands.join("\n"), {
    Type: "XObject", Subtype: "Form", BBox: [0, 0, markup.width, markup.height],
    Resources: { ExtGState: { GS: { Type: "ExtGState", CA: markup.opacity, ca: markup.opacity,
      BM: markup.subtype === "Highlight" ? "Multiply" : "Normal" } } },
  }));
  const annotation = context.obj({
    Type: "Annot", Subtype: markup.subtype, Rect: geometry.rect,
    NM: PDFHexString.fromText(markup.id),
    Contents: PDFHexString.fromText(markup.text), T: PDFHexString.fromText(markup.author),
    F: markup.flags ?? 4, CA: markup.opacity, BS: { W: markup.strokeWidth, S: "S" },
    P: page.ref, AP: { N: appearance },
    C: markup.color === null ? [] : rgb,
    ...(markup.subtype === "Text" ? { Name: markup.icon ?? "Comment" } : {}),
    ...(geometry.quadPoints ? { QuadPoints: geometry.quadPoints } : {}),
    ...(geometry.inkList ? { InkList: geometry.inkList } : {}),
    ...(markup.date !== undefined ? { M: PDFHexString.fromText(markup.date) } : {}),
    ...(markup.creationDate !== undefined ? { CreationDate: PDFHexString.fromText(markup.creationDate) } : {}),
    ...(markup.subject !== undefined ? { Subj: PDFHexString.fromText(markup.subject) } : {}),
  });
  if (markup.subtype === "Text") writeCommentMetadata(annotation, markup);
  page.node.addAnnot(context.register(annotation));
}
