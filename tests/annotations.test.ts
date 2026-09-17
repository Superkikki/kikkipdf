import { it, expect } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRef,
  PDFHexString,
} from "pdf-lib";
import { blankPage, emptyDocument, newObject } from "../src/state/model";
import { exportPdf } from "../src/export/engine";
import { editAnnotation } from "../src/annotations/commands";
import { duplicatePage } from "../src/commands/document";
import { pasteObject, reorderObject } from "../src/editor/objectActions";
import { History } from "../src/commands/history";

it("exports semantic highlight, underline, strikeout and ink with appearance streams", async () => {
  const d = emptyDocument();
  d.pages = [blankPage()];
  d.pages[0].objects = ["highlight", "underline", "strike", "ink"].map(
    (kind, i) => ({
      ...newObject(kind as "highlight", 20, 30 + i * 100),
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 40 },
      ],
    }),
  );
  const pdf = await PDFDocument.load(await exportPdf(d));
  const annots = pdf.getPage(0).node.Annots()!;
  expect(annots.size()).toBe(4);
  expect(
    Array.from({ length: 4 }, (_, i) =>
      annots.lookup(i, PDFDict).get(PDFName.of("Subtype"))?.toString(),
    ),
  ).toEqual(["/Highlight", "/Underline", "/StrikeOut", "/Ink"]);
  for (let i = 0; i < 4; i++)
    expect(
      annots
        .lookup(i, PDFDict)
        .lookup(PDFName.of("AP"), PDFDict)
        .get(PDFName.of("N")),
    ).toBeInstanceOf(PDFRef);
});
it("edits source comments per page copy and remaps links without copying deleted pages", async () => {
  const input = await PDFDocument.create();
  const a = input.addPage(),
    b = input.addPage(),
    c = input.addPage();
  const note = input.context.register(
    input.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [10, 10, 30, 30],
      Contents: PDFHexString.fromText("Before"),
      P: a.ref,
    }),
  );
  a.node.addAnnot(note);
  a.node.addAnnot(
    input.context.register(
      input.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [30, 30, 100, 50],
        Dest: [c.ref, "Fit"],
        P: a.ref,
      }),
    ),
  );
  a.node.addAnnot(
    input.context.register(
      input.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [30, 70, 100, 90],
        Dest: [b.ref, "Fit"],
        P: a.ref,
      }),
    ),
  );
  let d = emptyDocument();
  d.sources.s = { id: "s", name: "source.pdf", bytes: await input.save() };
  d.pages = [a, b, c].map((_, i) => ({
    ...blankPage(),
    sourceId: "s",
    sourceIndex: i,
  }));
  d = duplicatePage(d.pages[0].id).apply(d);
  d = editAnnotation(d.pages[0].id, `${note.objectNumber}R`, {
    text: "編集済み",
  }).apply(d);
  d = editAnnotation(d.pages[1].id, `${note.objectNumber}R`, {
    deleted: true,
  }).apply(d);
  const pdf = await PDFDocument.load(
    await exportPdf(d, undefined, { indices: [3, 0, 1] }),
  );
  const list = pdf.getPage(1).node.Annots()!;
  expect(
    list
      .lookup(0, PDFDict)
      .lookup(PDFName.of("Contents"), PDFHexString)
      .decodeText(),
  ).toBe("編集済み");
  expect(
    list.lookup(1, PDFDict).lookup(PDFName.of("Dest"), PDFArray).get(0),
  ).toEqual(pdf.getPage(0).ref);
  expect(list.lookup(2, PDFDict).get(PDFName.of("Dest"))).toBeUndefined();
  expect(pdf.getPage(2).node.Annots()?.size()).toBe(2);
  const pageObjects = pdf.context
    .enumerateIndirectObjects()
    .filter(
      ([, obj]) =>
        obj instanceof PDFDict &&
        obj.get(PDFName.of("Type")) === PDFName.of("Page"),
    );
  expect(pageObjects).toHaveLength(3);
});
it("shares font resources and keeps object paste/order undoable", async () => {
  const source = await PDFDocument.create();
  const font = await source.embedFont("Helvetica");
  for (let i = 0; i < 20; i++)
    source.addPage().drawText("Shared font", { font });
  const d = emptyDocument();
  d.sources.s = { id: "s", name: "s.pdf", bytes: await source.save() };
  d.pages = source
    .getPages()
    .map((_, i) => ({ ...blankPage(), sourceId: "s", sourceIndex: i }));
  const output = await PDFDocument.load(await exportPdf(d));
  const fonts = output.context
    .enumerateIndirectObjects()
    .filter(
      ([, v]) =>
        v instanceof PDFDict &&
        v.get(PDFName.of("Type")) === PDFName.of("Font"),
    );
  expect(fonts).toHaveLength(1);
  const a = newObject("text", 20, 20),
    b = newObject("rect", 50, 50);
  d.pages[0].objects = [a, b];
  const h = new History(d);
  const paste = pasteObject(d.pages[0].id, { object: a });
  h.execute(paste.command);
  expect(h.current.document.pages[0].objects).toHaveLength(3);
  h.execute(reorderObject(d.pages[0].id, paste.id, "back"));
  expect(h.current.document.pages[0].objects[0].id).toBe(paste.id);
  h.undo();
  h.undo();
  expect(h.current.document.pages[0].objects).toEqual([a, b]);
});
