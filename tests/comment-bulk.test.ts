import { expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { batchComments } from "../src/annotations/bulk";
import { buildComments, readComments } from "../src/annotations/comments";
import { blankPage, emptyDocument, newObject, type ImportedMarkup } from "../src/state/model";
import { History } from "../src/commands/history";
import { duplicatePage } from "../src/commands/document";
import { exportPdf } from "../src/export/engine";
import { saveProject, openProject } from "../src/state/project";

GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;
const name = (value: string) => PDFName.of(value);
async function fixture() {
  const pdf = await PDFDocument.create(), page = pdf.addPage();
  for (const subtype of ["Text", "Highlight"]) page.node.addAnnot(pdf.context.register(pdf.context.obj({
    Type: "Annot", Subtype: subtype, Rect: [10, 10, 30, 30], P: page.ref, Custom: PDFString.of("keep"),
    Contents: PDFHexString.fromText(`Source ${subtype}`), T: PDFHexString.fromText("Before"),
    ...(subtype === "Highlight" ? { QuadPoints: [10, 30, 30, 30, 10, 10, 30, 10] } : {}),
  })));
  const model = emptyDocument("comments.pdf");
  model.sources.s = { id: "s", name: "source.pdf", bytes: await pdf.save() };
  model.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0 }];
  model.pages[0].objects = [
    { ...newObject("note", 50, 60), text: "Added note", author: "Before" },
    { ...newObject("highlight", 80, 80), text: "Added highlight", author: "Before" },
  ];
  model.pages[0].importedMarkups = [{ id: "imported", subtype: "Text", x: 100, y: 100, width: 20, height: 20,
    text: "Imported note", author: "Before", reviewStatus: "None", color: "#ffce32", opacity: 1, strokeWidth: 1 } satisfies ImportedMarkup];
  const document = duplicatePage(model.pages[0].id).apply(model);
  return { model: document, imported: await readComments(document.sources.s) };
}

it("updates mixed comment origins atomically, scopes duplicated pages, preserves metadata and round-trips PDF/project", async () => {
  const { model, imported } = await fixture();
  const history = new History(model), pageId = model.pages[0].id;
  let rows = buildComments(history.current.document, imported).filter(row => row.pageId === pageId);
  expect(rows).toHaveLength(5);
  history.execute(batchComments(history.current.document, rows.filter(row => row.reviewable), { kind: "review", status: "Completed" }));
  expect(buildComments(history.current.document, imported).filter(row => row.pageId === pageId && row.reviewStatus === "Completed")).toHaveLength(3);
  expect(history.current.document.pages[1]).toBe(model.pages[1]);
  history.undo(); expect(history.current.document).toBe(model); expect(history.dirty).toBe(false); history.redo();
  rows = buildComments(history.current.document, imported).filter(row => row.pageId === pageId);
  history.execute(batchComments(history.current.document, rows, { kind: "author", author: "一括作成者" }));
  const current = history.current;
  history.execute(batchComments(current.document, buildComments(current.document, imported).filter(row => row.pageId === pageId), { kind: "author", author: "一括作成者" }));
  expect(history.current).toBe(current);
  const restored = await openProject(await saveProject(current.document));
  expect(buildComments(restored, imported).filter(row => row.pageId === pageId).every(row => row.author === "一括作成者")).toBe(true);
  const output = await PDFDocument.load(await exportPdf(restored));
  const annots = output.getPage(0).node.Annots()!;
  expect(annots.size()).toBe(5);
  for (const ref of annots.asArray()) {
    const annotation = output.context.lookup(ref, PDFDict);
    expect(annotation.lookup(name("T"), PDFHexString).decodeText()).toBe("一括作成者");
    if (annotation.get(name("Subtype")) === name("Text")) expect(annotation.lookup(name("State"), PDFString).decodeText()).toBe("Completed");
    else expect(annotation.has(name("State"))).toBe(false);
  }
  expect(annots.lookup(0, PDFDict).lookup(name("Custom"), PDFString).decodeText()).toBe("keep");
  expect(output.getPage(1).node.Annots()!.size()).toBe(5);
  const before = history.current;
  history.execute(batchComments(before.document, buildComments(before.document, imported).filter(row => row.pageId === pageId), { kind: "delete" }));
  expect(buildComments(history.current.document, imported)).toHaveLength(5);
  const deleted = await PDFDocument.load(await exportPdf(history.current.document));
  expect(deleted.getPage(0).node.Annots()?.size() ?? 0).toBe(0); expect(deleted.getPage(1).node.Annots()!.size()).toBe(5);
  history.undo(); expect(history.current).toBe(before); history.redo();
  expect(buildComments(await openProject(await saveProject(history.current.document)), imported)).toHaveLength(5);
});

it("rejects stale, unsupported, duplicate and oversized targets before any changes", async () => {
  const { model, imported } = await fixture(), rows = buildComments(model, imported), history = new History(model);
  expect(() => history.execute(batchComments(model, rows, { kind: "review", status: "Accepted" }))).toThrow(/編集できない/);
  expect(() => history.execute(batchComments(model, [rows[0], rows[0]], { kind: "delete" }))).toThrow();
  expect(() => history.execute(batchComments(model, [{ ...rows[0], id: "missing" }], { kind: "delete" }))).toThrow();
  expect(() => batchComments(model, Array.from({ length: 5001 }, () => rows[0]), { kind: "delete" })).toThrow(/5000/);
  expect(() => batchComments(model, rows, { kind: "author", author: "x".repeat(10001) })).toThrow(/10000/);
  const command = batchComments(model, rows, { kind: "delete" });
  expect(() => command.apply({ ...model })).toThrow(/文書が変更/);
  expect(history.current.document).toBe(model); expect(history.canUndo).toBe(false);
});
