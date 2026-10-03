import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, degrees } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { inspectDirectText } from "../src/direct/content";
import { directImageEdits, type DirectImageRun } from "../src/direct/model";
import { emptyDocument, blankPage, newObject, type DocumentModel } from "../src/state/model";
import { addObject, updateObject, duplicatePage, deleteObject, revertDirectImage } from "../src/commands/document";
import { exportPdf } from "../src/export/engine";
import { openProject, saveProject } from "../src/state/project";
import { History } from "../src/commands/history";

async function fixture(nested = false, rotated = false): Promise<DocumentModel> {
  const inner = await PDFDocument.create(), p = inner.addPage([420, 400]);
  const img = await inner.embedPng(await readFile("src-tauri/icons/32x32.png"));
  const font = await inner.embedFont(StandardFonts.Helvetica);
  p.drawText("Unchanged text", { x: 30, y: 320, font, size: 12 });
  p.drawImage(img, { x: 40, y: 220, width: 80, height: 40, rotate: degrees(rotated ? 30 : 0) });
  if (!nested) p.drawImage(img, { x: 180, y: 80, width: 80, height: 40 });
  let bytes = await inner.save();
  if (nested) {
    const input = await PDFDocument.load(bytes), middle = await PDFDocument.create();
    middle.addPage([420, 400]).drawPage(await middle.embedPage(input.getPage(0)));
    const mid = await PDFDocument.load(await middle.save()), outer = await PDFDocument.create();
    const page = outer.addPage([420, 400]), form = await outer.embedPage(mid.getPage(0));
    page.drawPage(form); page.drawPage(form, { y: -150 }); bytes = await outer.save();
  }
  const model = emptyDocument("images.pdf");
  model.sources.s = { id: "s", name: "images.pdf", bytes };
  model.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0, width: 420, height: 400 }];
  return model;
}
function object(run: DirectImageRun) {
  const { x, y, width, height } = run;
  return { ...newObject("direct-image", x, y), width, height, sourceImage: {
    ...run.reference, sourceId: "s", originalBox: { x, y, width, height }, bounds: run.bounds,
  } };
}
const inspect = (d: DocumentModel) => inspectDirectText(d.sources.s.bytes, 0);
describe("existing PDF image editing", () => {
  it("moves and resizes one nested shared invocation while keeping pixels, neighbours and duplicate pages", async () => {
    const input = await fixture(true), d = duplicatePage(input.pages[0].id).apply(input);
    const before = await inspect(d), target = before.images![0], o = object(target);
    expect(target.reference.formPath).toHaveLength(2);
    const edited = updateObject(d.pages[0].id, o.id, { x: target.x + 30, y: target.y + 10, width: 120, height: 32 })
      .apply(addObject(d.pages[0].id, o).apply(d));
    const loaded = await openProject(await saveProject(edited));
    expect(directImageEdits(loaded.pages[0])).toEqual(directImageEdits(edited.pages[0]));
    const bytes = await exportPdf(loaded), after = await inspectDirectText(bytes, 0), other = await inspectDirectText(bytes, 1);
    expect(after.images).toHaveLength(2); expect(other.images).toHaveLength(2);
    expect(after.images![0].x).toBeCloseTo(target.x + 30, 6);
    expect(after.images![0].y).toBeCloseTo(target.y + 10, 6);
    expect(after.images![0].width).toBeCloseTo(120, 6); expect(after.images![0].height).toBeCloseTo(32, 6);
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(after.images![1][key]).toBeCloseTo(before.images![1][key], 6);
      other.images!.forEach((image, i) => expect(image[key]).toBeCloseTo(before.images![i][key], 6));
    }
    after.runs.forEach((run, i) => { expect(run.x).toBe(before.runs[i].x); expect(run.y).toBe(before.runs[i].y); });
    const imagePixels = async (data: Uint8Array) => (await PDFDocument.load(data)).context.enumerateIndirectObjects()
      .flatMap(([, stream]) => stream instanceof PDFRawStream && stream.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
        ? [Buffer.from(stream.contents).toString("hex")] : []).sort();
    expect(await imagePixels(bytes)).toEqual(await imagePixels(d.sources.s.bytes));
  });
  it("deletes only the chosen invocation, removes all unused image data after both deletions and restores with undo", async () => {
    let d = await fixture(true); const runs = (await inspect(d)).images!;
    const first = object(runs[0]), second = object(runs[1]);
    d = addObject(d.pages[0].id, second).apply(addObject(d.pages[0].id, first).apply(d));
    const h = new History(d); h.execute(deleteObject(d.pages[0].id, first.id));
    expect((await inspectDirectText(await exportPdf(h.current.document), 0)).images).toHaveLength(1);
    h.undo(); expect((await inspectDirectText(await exportPdf(h.current.document), 0)).images).toHaveLength(2);
    h.redo(); h.execute(deleteObject(d.pages[0].id, second.id));
    const bytes = await exportPdf(h.current.document);
    expect((await inspectDirectText(bytes, 0)).images).toHaveLength(0);
    expect((await PDFDocument.load(bytes)).context.enumerateIndirectObjects().some(([, stream]) =>
      stream instanceof PDFRawStream && stream.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))).toBe(false);
    h.execute(revertDirectImage(d.pages[0].id, first.id));
    expect((await inspectDirectText(await exportPdf(h.current.document), 0)).images).toHaveLength(1);
  });
  it("uses the original CropBox coordinates on a rotated output page", async () => {
    const d = await fixture(), pdf = await PDFDocument.load(d.sources.s.bytes);
    pdf.getPage(0).setCropBox(20, 30, 360, 340); d.sources.s.bytes = await pdf.save();
    Object.assign(d.pages[0], { width: 360, height: 340, rotation: 90 });
    const run = (await inspect(d)).images![0]; expect(run.x).toBe(20); expect(run.y).toBe(110);
    const o = object(run), edited = updateObject(d.pages[0].id, o.id, { x: 35, y: 130, width: 100, height: 60 })
      .apply(addObject(d.pages[0].id, o).apply(d));
    const bytes = await exportPdf(edited), saved = await PDFDocument.load(bytes);
    expect(saved.getPage(0).getRotation().angle).toBe(90);
    expect(saved.getPage(0).getCropBox()).toEqual({ x: 20, y: 30, width: 360, height: 340 });
    const after = (await inspectDirectText(bytes, 0)).images![0];
    expect(after.x).toBeCloseTo(35, 6); expect(after.y).toBeCloseTo(130, 6);
    expect(after.width).toBeCloseTo(100, 6); expect(after.height).toBeCloseTo(60, 6);
  });
  it("refuses stale hashes, names, source identity, duplicate references and unverified geometry", async () => {
    const original = await fixture(), run = (await inspect(original)).images![0];
    const d = addObject(original.pages[0].id, object(run)).apply(original);
    for (const patch of [{ contentHash: "0".repeat(64) }, { resourceName: "Wrong" }, { sourceId: "other" },
      { formPath: [999] }, { originalBox: { x: 0, y: 0, width: 80, height: 40 } }]) {
      const invalid = structuredClone(d); Object.assign(invalid.pages[0].objects[0].sourceImage!, patch);
      await expect(exportPdf(invalid)).rejects.toThrow();
    }
    const duplicate = structuredClone(d); duplicate.pages[0].objects.push({ ...duplicate.pages[0].objects[0], id: "duplicate" });
    await expect(exportPdf(duplicate)).rejects.toThrow();
    for (const patch of [{ rotation: 10 }, { opacity: 0.5 }, { width: -1 }]) {
      const invalid = structuredClone(d); Object.assign(invalid.pages[0].objects[0], patch);
      await expect(exportPdf(invalid)).rejects.toThrow();
    }
  });
  it("refuses rotated images and keeps edits inside an enclosing Form's BBox", async () => {
    expect((await inspect(await fixture(false, true))).images).toHaveLength(1);
    const original = await fixture(true), run = (await inspect(original)).images![0], o = object(run);
    const d = addObject(original.pages[0].id, o).apply(original);
    const bounded = updateObject(d.pages[0].id, o.id, { x: 1000, y: -1000, width: 1000 }).apply(d);
    const image = (await inspectDirectText(await exportPdf(bounded), 0)).images![0];
    expect(image.x).toBe(0); expect(image.width).toBe(420); expect(image.y).toBe(0);
    const invalid = structuredClone(d); invalid.pages[0].objects[0].x = -1000;
    await expect(exportPdf(invalid)).rejects.toThrow("表示範囲");
  });
});
