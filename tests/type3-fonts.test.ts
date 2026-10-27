import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { type3Fixture } from "./fixtures/type3";
import { blankPage, emptyDocument } from "../src/state/model";
import { inspectDirectText } from "../src/direct/content";
import { directTextObject } from "../src/direct/editor";
import { addObject } from "../src/commands/document";
import { exportPdf } from "../src/export/engine";
import { openProject, saveProject } from "../src/state/project";
function model(bytes: Uint8Array) { const d = emptyDocument("type3.pdf"); d.sources.s = { id: "s", name: "type3.pdf", bytes }; d.pages = [{ ...blankPage(), width: 420, height: 400, sourceId: "s", sourceIndex: 0 }]; return d; }
describe("existing Type 3 fonts", () => {
  it("edits one glyph, preserves following positions and survives project and PDF saves", async () => {
    const d = model(await type3Fixture()), before = await inspectDirectText(d.sources.s.bytes, 0);
    expect(before.runs.map(run => run.text)).toEqual(["A", "B", " Neighbour"]); expect(before.runs[1].x).toBeCloseTo(50);
    const obj = directTextObject(before, d.pages[0], "A", before.runs[0]); obj.text = "Edited"; obj.font = "sans";
    const changed = addObject(d.pages[0].id, obj).apply(d), restored = await openProject(await saveProject(changed));
    const output = await exportPdf(restored), after = await inspectDirectText(output, 0);
    expect(after.runs.some(run => run.text === "A")).toBe(false); expect(after.runs.some(run => run.text === "Edited")).toBe(true);
    expect(after.runs.find(run => run.text === "B")!.x).toBeCloseTo(before.runs[1].x, 7); expect(after.runs.find(run => run.text === " Neighbour")!.x).toBeCloseTo(before.runs[2].x, 7);
    const pdf = await PDFDocument.load(output); expect(pdf.getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict)).toBeDefined();
  });
  it("uses ToUnicode for custom glyph names when the corresponding procedure exists", async () => {
    const before = await inspectDirectText(await type3Fixture({ name: "customglyph", unicode: "2 beginbfchar <41> <65E5> <42> <0042> endbfchar" }), 0);
    expect(before.runs[0].text).toBe("日"); expect(before.runs[1].text).toBe("B");
  });
  it("rejects unknown matrices, missing glyph procedures, unverified Unicode and conflicting widths", async () => {
    const cases = [ { matrix: [0.002, 0, 0, 0.002, 0, 0] }, { noProcedure: true }, { name: "unknownGlyph" }, { width: 700 }, { charProgram: "1 0 0 rg 500 0 d0" }, { charProgram: "500 1 d0" }, { noFirst: true }, { last: 67 } ];
    for (const options of cases) {
      const result = await inspectDirectText(await type3Fixture(options), 0);
      expect(result.runs.some(run => run.text === "A")).toBe(false); expect(result.unsupported).toBeTruthy();
    }
  });
});
