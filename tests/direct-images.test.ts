import { describe, it, expect } from "vitest";
import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFRawStream, StandardFonts, degrees } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { inspectDirectText } from "../src/direct/content";
import { directImageEdits, type DirectImageRun } from "../src/direct/model";
import { emptyDocument, blankPage, newObject, type DocumentModel } from "../src/state/model";
import { addObject, updateObject, duplicatePage, deleteObject, revertDirectImage } from "../src/commands/document";
import { exportPdf } from "../src/export/engine";
import { openProject, saveProject } from "../src/state/project";
import { replaceDirectImage } from "../src/images/commands";
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
  it("replaces only one nested shared occurrence, preserves another page and supports undo, delete and restore", async () => {
    const input = await fixture(true), d = duplicatePage(input.pages[0].id).apply(input);
    const before = (await inspect(d)).images!, o = object(before[0]);
    const h = new History(addObject(d.pages[0].id, o).apply(d));
    const asset = { id: "replacement", bytes: new Uint8Array(await readFile("src-tauri/icons/128x128.png")), mime: "image/png" as const };
    h.execute(replaceDirectImage(d.pages[0].id, o.id, asset));
    const loaded = await openProject(await saveProject(h.current.document));
    expect(loaded.pages[0].objects[0].imageId).toBe(asset.id); expect(loaded.images[asset.id].bytes).toEqual(asset.bytes);
    const sizes = async (data: Uint8Array) => (await PDFDocument.load(data)).context.enumerateIndirectObjects().flatMap(([, v]) =>
      v instanceof PDFRawStream && v.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") ? [v.dict.lookup(PDFName.of("Width"), PDFNumber).toString()] : []);
    const saved = await exportPdf(loaded); expect(await sizes(saved)).toContain("128"); expect(await sizes(saved)).toContain("32");
    const after = await inspectDirectText(saved, 0), other = await inspectDirectText(saved, 1);
    expect(after.images!.map(r => [r.x, r.y, r.width, r.height])).toEqual(before.map(r => [r.x, r.y, r.width, r.height]));
    expect(other.images!.map(r => [r.x, r.y, r.width, r.height])).toEqual(before.map(r => [r.x, r.y, r.width, r.height]));
    h.undo(); expect(await sizes(await exportPdf(h.current.document))).not.toContain("128");
    h.redo(); h.execute(deleteObject(d.pages[0].id, o.id)); expect(await sizes(await exportPdf(h.current.document))).not.toContain("128");
    h.execute(revertDirectImage(d.pages[0].id, o.id)); expect((await inspectDirectText(await exportPdf(h.current.document), 0)).images).toHaveLength(2);
    const missing = structuredClone(loaded); delete missing.images[asset.id]; await expect(exportPdf(missing)).rejects.toThrow(/差し替え/);
    const invalid = structuredClone(loaded); invalid.images[asset.id].bytes = new Uint8Array([0, 1]); await expect(exportPdf(invalid)).rejects.toThrow();
  });
  it("removes unreferenced original image and mask after replacing every occurrence", async () => {
    let d = await fixture(true); const runs = (await inspect(d)).images!;
    const asset = { id: "replacement", bytes: new Uint8Array(await readFile("src-tauri/icons/128x128.png")), mime: "image/png" as const };
    for (const [i, run] of runs.entries()) {
      const o = object(run); d = addObject(d.pages[0].id, o).apply(d);
      d = i === 0 ? replaceDirectImage(d.pages[0].id, o.id, asset).apply(d) : updateObject(d.pages[0].id, o.id, { imageId: asset.id }).apply(d);
    }
    const pdf = await PDFDocument.load(await exportPdf(d));
    const imageWidths = pdf.context.enumerateIndirectObjects().flatMap(([, v]) => v instanceof PDFRawStream && v.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") ? [v.dict.lookup(PDFName.of("Width"), PDFNumber).toString()] : []);
    expect(imageWidths.length).toBeGreaterThan(0); expect(imageWidths.every(n => n === "128")).toBe(true);
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

it("isolates only a selected nested image with its original pixels and mask, and validates references and size limits", async () => {
  const { isolatedImagePdf } = await import("../src/direct/content");
  const model = await fixture(true), run = (await inspect(model)).images![0];
  const reference = object(run).sourceImage!;
  const bytes = await isolatedImagePdf(model.sources.s.bytes, reference);
  const isolated = await PDFDocument.load(bytes);
  expect(isolated.getPageCount()).toBe(1);
  expect(isolated.getPage(0).getSize()).toEqual({ width: 32, height: 32 });
  const streams = isolated.context.enumerateIndirectObjects().flatMap(([, o]) => o instanceof PDFRawStream ? [o] : []);
  const pixels = (doc: PDFDocument) => doc.context.enumerateIndirectObjects().flatMap(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") ? [Buffer.from(o.contents).toString("hex")] : []).sort();
  expect(pixels(isolated)).toEqual(pixels(await PDFDocument.load(model.sources.s.bytes)));
  expect((await inspectDirectText(bytes, 0)).runs).toEqual([]);
  expect(streams.filter(s => s.dict.get(PDFName.of("Subtype")) === PDFName.of("Form"))).toHaveLength(0);
  await expect(isolatedImagePdf(model.sources.s.bytes, { ...reference, contentHash: "changed" })).rejects.toThrow("変更");
  await expect(isolatedImagePdf(model.sources.s.bytes, { ...reference, resourceName: "missing" })).rejects.toThrow("変更");
  await expect(isolatedImagePdf(model.sources.s.bytes, { ...reference, formPath: [999] })).rejects.toThrow("参照先");
  const huge = await PDFDocument.load(model.sources.s.bytes);
  const image = huge.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))![1] as PDFRawStream;
  image.dict.set(PDFName.of("Width"), PDFNumber.of(20000));
  await expect(isolatedImagePdf(await huge.save(), reference)).rejects.toThrow("画素");
});

it("pastes independent copies of extracted images across documents, keeps source dimensions and supports undo/project/PDF", async () => {
  const { pasteObject } = await import("../src/editor/objectActions");
  const source = await fixture(true), run = (await inspect(source)).images![0], original = object(run);
  const image = { id: "pixels", bytes: new Uint8Array(await readFile("src-tauri/icons/32x32.png")), mime: "image/png" as const };
  const target = emptyDocument(); target.pages = [blankPage()];
  expect(() => pasteObject(target.pages[0].id, { object: original })).toThrow("データ");
  expect(() => pasteObject(target.pages[0].id, { object: { ...original, imageDeleted: true }, image })).toThrow();
  const history = new History(target), paste = pasteObject(target.pages[0].id, { object: original, image });
  history.execute(paste.command);
  const copy = history.current.document.pages[0].objects[0];
  expect(copy).toMatchObject({ kind: "image", width: original.width, height: original.height, x: original.x + 12, y: original.y + 12 });
  expect(copy.sourceImage).toBeUndefined(); expect(copy.imageId).not.toBe(image.id);
  const restored = await openProject(await saveProject(history.current.document));
  expect(restored.pages[0].objects[0]).toMatchObject({ kind: "image", imageId: copy.imageId });
  expect((await inspectDirectText(await exportPdf(restored), 0)).images).toHaveLength(1);
  history.undo(); expect(history.current.document.pages[0].objects).toHaveLength(0); expect(Object.keys(history.current.document.images)).toHaveLength(0);
  history.redo(); expect(history.current.document.pages[0].objects).toHaveLength(1);
});

it("retains named image color spaces from nested resource dictionaries", async () => {
  const { isolatedImagePdf, analyzePage } = await import("../src/direct/content");
  const model = await fixture(true), input = await PDFDocument.load(model.sources.s.bytes);
  const root = await analyzePage(input.getPage(0), 0), run = root.images[0];
  let node = root;
  for (const index of run.reference.formPath ?? []) node = node.children.get(index)!.analysis;
  const resource = node.resources!.lookup(PDFName.of("XObject"), PDFDict).lookup(PDFName.of(run.reference.resourceName)) as PDFRawStream;
  resource.dict.set(PDFName.of("ColorSpace"), PDFName.of("SharedRGB"));
  node.resources!.set(PDFName.of("ColorSpace"), input.context.obj({ SharedRGB: "DeviceRGB" }));
  const saved = await input.save(), reference = object((await inspectDirectText(saved, 0)).images![0]).sourceImage!;
  const isolated = await PDFDocument.load(await isolatedImagePdf(saved, reference));
  expect(isolated.getPage(0).node.Resources()!.lookup(PDFName.of("ColorSpace"), PDFDict).get(PDFName.of("SharedRGB"))).toBe(PDFName.of("DeviceRGB"));
  const copied = isolated.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).lookup(PDFName.of("Image")) as PDFRawStream;
  expect(copied.dict.get(PDFName.of("ColorSpace"))).toBe(PDFName.of("DeviceRGB"));
  node.resources!.set(PDFName.of("ColorSpace"), input.context.obj({ SharedRGB: "SharedRGB" }));
  await expect(isolatedImagePdf(await input.save(), reference)).rejects.toThrow("循環");
});
