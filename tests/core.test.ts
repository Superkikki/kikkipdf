import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts, PDFName, PDFArray } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { History } from "../src/commands/history";
import {
  reorderPage,
  deletePages,
  duplicatePage,
  rotatePage,
  insertBlank,
  addObject,
  updateObject,
} from "../src/commands/document";
import {
  blankPage,
  emptyDocument,
  newObject,
  type DocumentModel,
} from "../src/state/model";
import { parseRange } from "../src/pages/ranges";
import { screenToPage, pageToPdf } from "../src/viewer/coordinates";
import { exportPdf, inspectForms, imagesToPdf } from "../src/export/engine";
function model(count = 3) {
  const d = emptyDocument();
  d.pages = Array.from({ length: count }, blankPage);
  return d;
}
describe("page commands and immutable history", () => {
  it("reorders, removes, rotates and undoes without mutating a saved revision", () => {
    const d = model(),
      h = new History(d);
    const ids = d.pages.map((p) => p.id);
    h.execute(reorderPage(ids[0], ids[2]));
    expect(h.current.document.pages.map((p) => p.id)).toEqual([
      ids[1],
      ids[2],
      ids[0],
    ]);
    h.execute(deletePages([ids[2]]));
    h.execute(rotatePage(ids[0]));
    expect(h.current.document.pages[1].rotation).toBe(90);
    expect(d.pages[0].rotation).toBe(0);
    h.markSaved();
    expect(h.dirty).toBe(false);
    h.undo();
    expect(h.dirty).toBe(true);
    h.redo();
    expect(h.dirty).toBe(false);
    h.undo();
    h.execute(insertBlank());
    expect(h.canRedo).toBe(false);
  });
  it("duplicates with independent identity and supports object undo", () => {
    const d = model(1),
      o = newObject("text", 10, 20);
    d.pages[0].objects = [o];
    const h = new History(d);
    h.execute(duplicatePage(d.pages[0].id));
    const copy = h.current.document.pages[1];
    expect(copy.id).not.toBe(d.pages[0].id);
    expect(copy.objects[0].id).not.toBe(o.id);
    h.execute(updateObject(copy.id, copy.objects[0].id, { text: "edited" }));
    expect(h.current.document.pages[0].objects[0].text).toBe("テキスト");
    h.undo();
    expect(h.current.document.pages[1].objects[0].text).toBe("テキスト");
  });
  it("rejects deleting every page", () => {
    const d = model(1);
    expect(() => deletePages([d.pages[0].id]).apply(d)).toThrow();
  });
  it("marks only the exported revision saved if edits occur during save", () => {
    const d = model(),
      h = new History(d),
      token = h.current.token;
    h.execute(rotatePage(d.pages[0].id));
    h.markSaved(token);
    expect(h.dirty).toBe(true);
  });
});
describe("ranges and coordinates", () => {
  it("parses inclusive ranges and rejects malformed/out-of-bound input", () => {
    expect(parseRange("1-3, 5,2", 5)).toEqual([0, 1, 2, 4]);
    expect(parseRange("", 3)).toEqual([0, 1, 2]);
    for (const r of ["0", "4", "2-1", "1-x", "1,"])
      expect(() => parseRange(r, 3)).toThrow();
  });
  it("maps rotated and scaled page points back to original PDF coordinates", () => {
    expect(screenToPage({ x: 60, y: 40 }, 100, 200, 90, 2)).toEqual({
      x: 20,
      y: 170,
    });
    expect(screenToPage({ x: 60, y: 40 }, 100, 200, 180, 2)).toEqual({
      x: 70,
      y: 180,
    });
    expect(screenToPage({ x: 60, y: 40 }, 100, 200, 270, 2)).toEqual({
      x: 80,
      y: 30,
    });
    expect(pageToPdf({ x: 20, y: 170 }, 200, { x: 10, y: 30 })).toEqual({
      x: 30,
      y: 60,
    });
  });
});
async function sourceModel(): Promise<DocumentModel> {
  const input = await PDFDocument.create();
  const f = await input.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const p = input.addPage([300 + i * 10, 400]);
    p.drawText(`Original page ${i + 1}`, { x: 30, y: 330, font: f, size: 18 });
  }
  const d = model();
  d.sources.s = { id: "s", name: "source.pdf", bytes: await input.save() };
  d.pages = d.pages.map((p, i) => ({
    ...p,
    sourceId: "s",
    sourceIndex: i,
    width: 300 + i * 10,
    height: 400,
  }));
  return d;
}
describe("real PDF export and reload", () => {
  it("preserves page identity after reorder, delete, rotate, crop and text/image edits", async () => {
    let d = await sourceModel();
    const [a, b, c] = d.pages.map((p) => p.id);
    d = reorderPage(c, a).apply(d);
    d = deletePages([b]).apply(d);
    d = rotatePage(c).apply(d);
    const text = {
      ...newObject("text", 30, 50),
      font: "sans" as const,
      text: "Kikki export test",
    };
    d = addObject(c, text).apply(d);
    const png = new Uint8Array(await readFile("src-tauri/icons/32x32.png"));
    d.images.img = { id: "img", bytes: png, mime: "image/png" };
    d = addObject(c, {
      ...newObject("image", 20, 90),
      imageId: "img",
      width: 32,
      height: 32,
    }).apply(d);
    d = addObject(c, {
      ...newObject("note", 50, 160),
      text: "Review comment",
    }).apply(d);
    d.pages[0] = {
      ...d.pages[0],
      crop: { x: 10, y: 10, width: 280, height: 370 },
    };
    const output = await PDFDocument.load(await exportPdf(d));
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getRotation().angle).toBe(90);
    expect(output.getPage(0).getCropBox()).toEqual({
      x: 10,
      y: 20,
      width: 280,
      height: 370,
    });
    expect(output.getPage(1).getWidth()).toBe(300);
    expect(
      output.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(),
    ).toBe(1);
  });
  it("embeds Japanese and creates standalone image PDF", async () => {
    const d = model(1);
    d.pages[0].objects = [
      { ...newObject("text", 30, 40), text: "日本語の編集テスト" },
    ];
    const font = new Uint8Array(await readFile("public/assets/NotoSansJP.ttf"));
    const bytes = await exportPdf(d, font);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const png = new Uint8Array(await readFile("src-tauri/icons/32x32.png"));
    expect(
      (
        await PDFDocument.load(
          await imagesToPdf([
            { bytes: png, width: 100, height: 200, mime: "image/png" },
          ]),
        )
      )
        .getPage(0)
        .getHeight(),
    ).toBe(200);
  });
  it("reads and fills standard form fields before flattening", async () => {
    const pdf = await PDFDocument.create();
    const p = pdf.addPage();
    const form = pdf.getForm();
    const t = form.createTextField("Name");
    t.addToPage(p);
    t.setText("Before");
    const c = form.createCheckBox("Agree");
    c.addToPage(p, { x: 10, y: 10 });
    const d = model(1);
    d.sources.s = { id: "s", name: "form.pdf", bytes: await pdf.save() };
    d.pages[0].sourceId = "s";
    expect((await inspectForms(d)).map((f) => f.name)).toEqual([
      "Name",
      "Agree",
    ]);
    d.formValues = { "s:Name": "After", "s:Agree": true };
    const saved = await PDFDocument.load(await exportPdf(d));
    expect(saved.getForm().getFields()).toHaveLength(2);
    expect(saved.getForm().getTextField("Name").getText()).toBe("After");
    expect(saved.getForm().getCheckBox("Agree").isChecked()).toBe(true);
    expect(saved.getPageCount()).toBe(1);
  });
  it("exports only requested pages in given order", async () => {
    const d = await sourceModel();
    const pdf = await PDFDocument.load(
      await exportPdf(d, undefined, { indices: [2, 0] }),
    );
    expect(pdf.getPages().map((p) => p.getWidth())).toEqual([320, 300]);
  });
});

describe("save identity and stroke resizing", () => {
  it("keeps the Save As destination through undo and redo", () => {
    const d = model(),
      h = new History(d);
    h.execute(rotatePage(d.pages[0].id));
    h.rename("copy.pdf", "C:/copy.pdf");
    h.undo();
    expect(h.current.document.path).toBe("C:/copy.pdf");
    h.redo();
    expect(h.current.document.name).toBe("copy.pdf");
  });
  it("resizes ink coordinates and can undo that change", () => {
    const d = model(1),
      o = {
        ...newObject("ink", 10, 10),
        width: 20,
        height: 30,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 30 },
        ],
      };
    d.pages[0].objects = [o];
    const h = new History(d);
    h.execute(updateObject(d.pages[0].id, o.id, { width: 40, height: 60 }));
    expect(h.current.document.pages[0].objects[0].points?.[1]).toEqual({
      x: 40,
      y: 60,
    });
    h.undo();
    expect(h.current.document.pages[0].objects[0].points?.[1]).toEqual({
      x: 20,
      y: 30,
    });
  });
});
