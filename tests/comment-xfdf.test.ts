import { describe, expect, it } from "vitest";
import { degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from "pdf-lib";
import { commentsXfdf } from "../src/annotations/commentXfdf";
import type { CommentRow } from "../src/annotations/comments";
import { blankPage, emptyDocument, newObject } from "../src/state/model";
import { exportPdf } from "../src/export/engine";

const row = (id: string, pageId: string, pageIndex: number, added = true): CommentRow => ({
  id, key: id, pageId, pageIndex, text: "A & <note>\r\n\u0001", author: "A\tB & C",
  reviewStatus: "Accepted", reviewable: true, added, editable: true,
});
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const attr = (xml: string, name: string) => {
  const value = xml.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  if (!value) throw Error(`missing ${name}`);
  return value.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
};
function pdfNumbers(dict: PDFDict, key: string): number[] {
  const array = dict.lookup(PDFName.of(key), PDFArray);
  return Array.from({ length: array.size() }, (_, i) => array.lookup(i, PDFNumber).asNumber());
}
function inkNumbers(dict: PDFDict): number[][] {
  const list = dict.lookup(PDFName.of("InkList"), PDFArray);
  return Array.from({ length: list.size() }, (_, i) => {
    const gesture = list.lookup(i, PDFArray);
    return Array.from({ length: gesture.size() }, (_, j) => gesture.lookup(j, PDFNumber).asNumber());
  });
}

describe("commentsXfdf", () => {
  it("matches added annotation geometry written to PDF, including crop origin and resized note", async () => {
    const sourcePdf = await PDFDocument.create();
    const sourcePage = sourcePdf.addPage([600, 800]);
    sourcePage.setCropBox(20, 30, 500, 700);
    const model = emptyDocument("review.pdf");
    model.sources.s = { id: "s", name: "review.pdf", bytes: await sourcePdf.save() };
    model.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0, width: 600, height: 800, rotation: 90,
      crop: { x: 20, y: 30, width: 500, height: 700 } }];
    const [note, highlight, underline, strike, ink] = ["note", "highlight", "underline", "strike", "ink"]
      .map((kind) => newObject(kind as "note", 15, 25));
    Object.assign(note, { width: 24, height: 40, text: "Note", author: "A" });
    for (const object of [highlight, underline, strike, ink]) Object.assign(object, { width: 80, height: 30, text: object.kind, author: "Editor" });
    ink.points = [{ x: 4, y: 5 }, { x: 25, y: 17 }];
    model.pages[0].objects = [note, highlight, underline, strike, ink];
    const rows = model.pages[0].objects.map((o) => ({ ...row(o.id, model.pages[0].id, 0), text: o.text ?? "", author: o.author ?? "" }));
    const testRows = rows.map((r, i) => i === 1 ? { ...r, text: "A & <note>\r\n\u0001", author: "A\tB & C", reviewable: false } : { ...r, reviewable: i === 0 });
    const xfdf = decode(await commentsXfdf(model, testRows));
    expect(xfdf).toContain('<f href="review.pdf"/>');
    expect(xfdf.match(/statemodel="Review"/g)).toHaveLength(1);
    expect(xfdf).toContain("A &amp; &lt;note&gt;&#13;&#10;�");
    expect(xfdf).toContain('title="A&#9;B &amp; C"');

    const exported = await PDFDocument.load(await exportPdf(model));
    const annots = exported.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const byNm = new Map<string, PDFDict>();
    for (let i = 0; i < annots.size(); i++) {
      const dict = annots.lookup(i, PDFDict);
      const subtype = dict.lookup(PDFName.of("Subtype"), PDFName).decodeText();
      byNm.set(subtype === "Text" ? "note" : subtype.toLowerCase(), dict);
    }
    for (const object of [highlight, underline, strike]) {
      const dict = byNm.get(object.kind === "strike" ? "strikeout" : object.kind)!;
      const tag = object.kind === "strike" ? "strikeout" : object.kind;
      const element = xfdf.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0];
      expect(element).toBeDefined();
      expect(attr(element!, "rect").split(",").map(Number)).toEqual(pdfNumbers(dict, "Rect"));
      expect(attr(element!, "coords").split(",").map(Number)).toEqual(pdfNumbers(dict, "QuadPoints"));
    }
    const inkTag = xfdf.match(/<ink\b[^>]*>[\s\S]*?<inklist>[\s\S]*?<\/inklist>[\s\S]*?<\/ink>/)?.[0];
    expect(inkTag).toBeDefined();
    const gesture = inkTag!.match(/<gesture>([^<]+)<\/gesture>/)?.[1];
    expect(attr(inkTag!, "rect").split(",").map(Number)).toEqual(pdfNumbers(byNm.get("ink")!, "Rect"));
    expect(gesture?.split(";").flatMap((p) => p.split(",").map(Number))).toEqual(inkNumbers(byNm.get("ink")!).flat());
    const textTag = xfdf.match(/<text\b[^>]*>/)?.[0];
    expect(attr(textTag!, "rect").split(",").map(Number)).toEqual(pdfNumbers(byNm.get("note")!, "Rect"));
  });

  it("preserves source PDF geometry and rejects unsupported existing subtypes", async () => {
    const sourcePdf = await PDFDocument.create();
    const page = sourcePdf.addPage([400, 500]);
    page.setCropBox(20, 30, 350, 450);
    page.setRotation(degrees(90));
    const context = sourcePdf.context;
    const add = (subtype: string, key: string, value: number[] | number[][]) => {
      const geometry = key === "high" ? { QuadPoints: value } : key === "ink" ? { InkList: value } : { Name: "Comment" };
      const ref = context.register(context.obj({ Type: "Annot", Subtype: subtype, Rect: [30, 40, 80, 90], NM: PDFHexString.fromText(key),
        Contents: PDFHexString.fromText("Original"), T: PDFHexString.fromText("Writer"), F: 4, ...geometry }));
      page.node.addAnnot(ref);
      return ref;
    };
    const high = add("Highlight", "high", [31, 90, 80, 90, 31, 40, 80, 40]);
    const ink = add("Ink", "ink", [[1, 2, 3, 4], [8, 9]]);
    const unsupported = add("Squiggly", "wave", [31, 90, 80, 90, 31, 40, 80, 40]);
    const sourceBytes = await sourcePdf.save();
    const ids = [high, ink, unsupported].map((ref) => `${ref.objectNumber}R${ref.generationNumber || ""}`);
    const model = emptyDocument("source.pdf");
    model.sources.s = { id: "s", name: "source.pdf", bytes: sourceBytes };
    model.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0, width: 400, height: 500, rotation: 90,
      crop: { x: 20, y: 30, width: 350, height: 450 } }];
    model.pages.push({ ...model.pages[0], id: "duplicate-page" });
    const rows = [row(ids[0], model.pages[0].id, 0, false), row(ids[0], model.pages[1].id, 1, false), row(ids[1], model.pages[0].id, 0, false)];
    const xml = decode(await commentsXfdf(model, rows));
    expect(xml).toContain('coords="31,90,80,90,31,40,80,40"');
    expect(xml).toContain("1,2;3,4");
    expect(xml.match(/<highlight\b/g)).toHaveLength(2);
    expect(xml).toContain('page="0"');
    expect(xml).toContain('page="1"');
    const names = [...xml.matchAll(/<highlight\b[^>]*\bname="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(names).size).toBe(2);
    const filtered = decode(await commentsXfdf(model, [rows[2]]));
    expect(filtered.match(/<ink\b/g)).toHaveLength(1);
    expect(filtered).not.toContain("<highlight");
    await expect(commentsXfdf(model, [row(ids[2], model.pages[0].id, 0, false)])).rejects.toThrow("Squiggly");
  });
});
