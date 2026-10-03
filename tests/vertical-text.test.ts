import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { layoutVertical } from "../src/text/vertical";
import { inspectDirectText } from "../src/direct/content";
import { boundedDecode } from "../src/direct/pdfFonts";
import { directTextObject } from "../src/direct/editor";
import { blankPage, emptyDocument, newObject } from "../src/state/model";
import { exportPdf } from "../src/export/engine";
import { openProject, saveProject } from "../src/state/project";
const bytes = new Uint8Array(await readFile("public/assets/NotoSansJP-Regular.otf"));
async function fixture(w2?: (number | number[])[], dw2?: number[]) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const page = pdf.addPage([420, 595]);
  const font = await pdf.embedFont(bytes, { subset: false });
  const first = font.encodeText("日本語").toString(), second = font.encodeText("後続").toString();
  await pdf.flush();
  const dict = pdf.context.lookup(font.ref, PDFDict);
  dict.set(PDFName.of("Encoding"), PDFName.of("Identity-V"));
  const descendant = dict.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
  if (w2) descendant.set(PDFName.of("W2"), pdf.context.obj(w2));
  if (dw2) descendant.set(PDFName.of("DW2"), pdf.context.obj(dw2));
  page.node.set(PDFName.of("Resources"), pdf.context.obj({ Font: { F1: font.ref } }));
  page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(`BT /F1 20 Tf 80 Tz 2 Tc 3 Ts 1 0 0 1 300 520 Tm [${first} 125] TJ ${second} Tj ET`)));
  return pdf.save();
}
const model = (source: Uint8Array) => {
  const d = emptyDocument("vertical.pdf"); d.sources.s = { id: "s", name: "vertical.pdf", bytes: source };
  d.pages = [{ ...blankPage(), width: 420, height: 595, sourceId: "s", sourceIndex: 0 }]; return d;
};
describe("vertical text layout and original editing", () => {
  it("uses vertical alternate punctuation and preserves all cells when wrapping", () => {
    const o = { ...newObject("text", 0, 0), writingMode: "vertical" as const, font: "japanese" as const, fontSize: 20, height: 40, wrap: true, text: "日本、。「」ー" };
    const layout = layoutVertical(o, bytes), font = fontkit.create(bytes);
    expect(layout.lines.map(l => l.text)).toEqual(["日本", "、。", "「」", "ー"]);
    expect(layout.vertical!.cells.map(c => c.text).join("")).toBe(o.text);
    const punctuation = layout.vertical!.cells.find(c => c.text === "、")!;
    expect(punctuation.id).not.toBe(font.layout("、").glyphs[0].id);
    expect(layout.width).toBe(95);
    expect(() => layoutVertical({ ...o, text: "😀" }, bytes)).toThrow();
    expect(() => layoutVertical({ ...o, text: "日".repeat(10001) }, bytes)).toThrow(/10000/);
  });
  it("removes vertical source glyphs while keeping downstream origins with Tc/Tz/Ts/TJ", async () => {
    const d = model(await fixture()); const before = await inspectDirectText(d.sources.s.bytes, 0);
    expect(before.runs.map(r => r.text)).toEqual(["日本語", "後続"]);
    const run = before.runs[0]; expect(run.writingMode).toBe("vertical");
    const o = directTextObject(before, d.pages[0], run.text, { x: run.flowX! - 10, y: run.flowTop!, width: 20, height: 60 });
    o.text = "変更、。「」ー"; o.opacity = 0.5; d.pages[0].objects.push(o);
    const saved = await exportPdf(d, bytes); const after = await inspectDirectText(saved, 0);
    expect(after.runs.some(r => r.text === "日本語")).toBe(false);
    const neighbour = after.runs.find(r => r.text === "後続")!;
    expect(neighbour.flowX).toBeCloseTo(before.runs[1].flowX!, 7);
    expect(neighbour.flowTop).toBeCloseTo(before.runs[1].flowTop!, 7);
    expect(after.runs.find(r => r.text === o.text)?.writingMode).toBe("vertical");
    expect(after.runs.find(r => r.text === o.text)?.opacity).toBe(0.5);
    const loaded = await openProject(await saveProject(d)); expect(loaded.pages[0].objects[0].writingMode).toBe("vertical");
    const pdf = await PDFDocument.load(saved);
    const streams = pdf.context.enumerateIndirectObjects().filter(([, v]) => v instanceof PDFRawStream).map(([, v]) => new TextDecoder().decode(boundedDecode(v as PDFRawStream, 32 * 1024 * 1024)));
    expect(streams.some(s => s.includes("KikkiVerticalUnicode") && s.includes("beginbfchar"))).toBe(true);
  });
  it("edits one nested shared Form invocation on a cropped rotated page", async () => {
    const source = await PDFDocument.load(await fixture());
    const middle = await PDFDocument.create(); middle.addPage([420, 595]).drawPage(await middle.embedPage(source.getPage(0)));
    const loaded = await PDFDocument.load(await middle.save());
    const outer = await PDFDocument.create(), page = outer.addPage([500, 700]);
    const form = await outer.embedPage(loaded.getPage(0)); page.drawPage(form); page.drawPage(form, { x: -100 });
    page.setCropBox(10, 20, 480, 650);
    const d = model(await outer.save()); d.pages[0].width = 480; d.pages[0].height = 650; d.pages[0].rotation = 90;
    const before = await inspectDirectText(d.sources.s.bytes, 0);
    expect(before.runs.filter(r => r.text === "日本語")).toHaveLength(2);
    const run = before.runs[0];
    const o = directTextObject(before, d.pages[0], run.text, { x: run.flowX! - 10, y: run.flowTop!, width: 20, height: 60 });
    o.text = "置換"; d.pages[0].objects.push(o);
    const saved = await exportPdf(d, bytes), after = await inspectDirectText(saved, 0);
    expect(after.runs.filter(r => r.text === "日本語")).toHaveLength(1);
    expect(after.runs.filter(r => r.text === "後続")).toHaveLength(2);
    expect(after.runs.find(r => r.text === "置換")?.flowX).toBeCloseTo(run.flowX!, 7);
    expect(after.runs.find(r => r.text === "置換")?.flowTop).toBeCloseTo(run.flowTop!, 7);
    expect((await PDFDocument.load(saved)).getPage(0).getRotation().angle).toBe(90);
  });
  it("accumulates vertical Unicode glyph maps across pages and retains horizontal font encoding", async () => {
    const d = emptyDocument(); const p = blankPage();
    p.objects = [{ ...newObject("text", 200, 40), writingMode: "vertical", wrap: false, text: "日本、。", font: "japanese" },
      { ...newObject("text", 20, 220), text: "横書き", font: "japanese" }];
    const p2 = blankPage(); p2.objects = [{ ...newObject("text", 150, 40), writingMode: "vertical", wrap: false, text: "「」ー", font: "japanese" }]; d.pages = [p, p2];
    const saved = await exportPdf(d, bytes);
    expect((await inspectDirectText(saved, 0)).runs.map(r => r.text)).toEqual(["日本、。", "横書き"]);
    expect((await inspectDirectText(saved, 1)).runs.map(r => r.text)).toEqual(["「」ー"]);
  });
  it("reads W2 array/range metrics and DW2 defaults and rejects malformed metrics", async () => {
    const font = fontkit.create(bytes), cid = font.layout("日").glyphs[0].id;
    for (const w2 of [[cid, [-1200, 600, 900]], [cid, cid, -1200, 600, 900]]) {
      const result = await inspectDirectText(await fixture(w2, [800, -900]), 0);
      expect(result.runs[0].flowEnd! - result.runs[0].flowTop!).toBeCloseTo(56.5);
    }
    for (const w2 of [[cid, [-1000, 500]], [cid, [0, 500, 880]], [65536, [-1000, 500, 880]], [cid, [-1000, 500, 880], cid, [-1000, 500, 880]]])
      expect((await inspectDirectText(await fixture(w2), 0)).runs).toHaveLength(0);
    for (const dw2 of [[880], [880, 0], [880, -100001]])
      expect((await inspectDirectText(await fixture(undefined, dw2), 0)).runs).toHaveLength(0);
  });
});
