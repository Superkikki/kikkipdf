import { expect, it } from "vitest";
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from "pdf-lib";
import { buildComments, filterComments, readComments } from "../src/annotations/comments";
import { writeCommentMetadata } from "../src/annotations/commentMetadata";
import { duplicatePage } from "../src/commands/document";
import { History } from "../src/commands/history";
import { editAnnotation } from "../src/annotations/commands";
import { exportPdf } from "../src/export/engine";
import { openProject, saveProject } from "../src/state/project";
import { blankPage, emptyDocument, newObject } from "../src/state/model";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

it("imports Text comments and caches immutable bytes without leaking source IDs", async () => {
  const input = await PDFDocument.create();
  const page = input.addPage();
  const note = input.context.register(input.context.obj({
    Type: "Annot", Subtype: "Text", Rect: [10, 10, 30, 30],
    Contents: PDFHexString.fromText("Check this"), T: PDFHexString.fromText("Ａｌｉｃｅ"),
    StateModel: PDFString.of("Review"), State: PDFString.of("Accepted"), P: page.ref,
  }));
  page.node.addAnnot(note);
  page.node.addAnnot(input.context.register(input.context.obj({
    Type: "Annot", Subtype: "Text", Rect: [40, 10, 60, 30], P: page.ref,
  })));
  page.node.addAnnot(input.context.register(input.context.obj({
    Type: "Annot", Subtype: "Link", Rect: [70, 10, 90, 30], URI: "https://example.test", P: page.ref,
  })));
  const bytes = await input.save();
  const one = await readComments({ id: "first", name: "a.pdf", bytes });
  const two = await readComments({ id: "second", name: "b.pdf", bytes });
  expect(one[0]).toMatchObject({ sourceId: "first", id: `${note.objectNumber}R`, text: "Check this", author: "Ａｌｉｃｅ", reviewStatus: "Accepted", reviewable: true });
  expect(one).toHaveLength(2);
  expect(one[1]).toMatchObject({ text: "", reviewStatus: "None", reviewable: true });
  expect(two[0]).toMatchObject({ sourceId: "second", id: one[0].id });
  expect(two[0]).not.toBe(one[0]);
});

it("binds comments to logical page copies, applies edits, and filters by normalized text, author, status, and page", () => {
  let d = emptyDocument();
  d.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0 }, blankPage()];
  const originalId = d.pages[0].id;
  const imported = [{ id: "12R", sourceId: "s", sourceIndex: 0, text: "Review the ① section", author: "Ａｌｉｃｅ", reviewStatus: "Accepted" as const, reviewable: true }];
  d = duplicatePage(originalId).apply(d);
  const copyId = d.pages[1].id;
  const history = new History(d);
  history.execute(editAnnotation(copyId, "12R", { author: "Bob", reviewStatus: "Rejected" }));
  d = history.current.document;
  const rows = buildComments(d, imported);
  expect(rows.map((row) => row.key)).toEqual([`${originalId}:12R`, `${copyId}:12R`]);
  expect(rows[1]).toMatchObject({ author: "Bob", reviewStatus: "Rejected", pageIndex: 1 });
  expect(filterComments(rows, { query: "1", author: "", status: "", pageId: "" })).toHaveLength(2);
  expect(filterComments(rows, { query: "BOB", author: "", status: "", pageId: "" })).toHaveLength(1);
  expect(filterComments(rows, { query: "", author: "Ａｌｉｃｅ", status: "Accepted", pageId: originalId })).toHaveLength(1);
  expect(filterComments(rows, { query: "", author: "", status: "Rejected", pageId: copyId })).toHaveLength(1);
  history.undo();
  expect(buildComments(history.current.document, imported)[1]).toMatchObject({ author: "Ａｌｉｃｅ", reviewStatus: "Accepted" });
  history.redo();
  expect(buildComments(history.current.document, imported)[1]).toMatchObject({ author: "Bob", reviewStatus: "Rejected" });
});

it("round-trips note and imported comment metadata through project and PDF export", async () => {
  const source = await PDFDocument.create();
  const page = source.addPage();
  const ref = source.context.register(source.context.obj({
    Type: "Annot", Subtype: "Text", Rect: [10, 10, 30, 30],
    Contents: PDFHexString.fromText("Imported"), T: PDFHexString.fromText("Initial"),
    CustomFlag: PDFString.of("preserve"), P: page.ref,
  }));
  page.node.addAnnot(ref);
  const model = emptyDocument("comments.pdf");
  model.sources.source = { id: "source", name: "source.pdf", bytes: await source.save() };
  model.pages = [{ ...blankPage(), sourceId: "source", sourceIndex: 0 }];
  model.pages[0].objects = [{ ...newObject("note", 50, 60), text: "New note", author: "Reviewer", reviewStatus: "Completed" }];
  const imported = await readComments(model.sources.source);
  const history = new History(model);
  history.execute(editAnnotation(model.pages[0].id, imported[0].id, { author: "Updated", reviewStatus: "Accepted" }));
  const reopenedProject = await openProject(await saveProject(history.current.document));
  expect(buildComments(reopenedProject, imported)[0]).toMatchObject({ author: "Updated", reviewStatus: "Accepted" });

  const output = await PDFDocument.load(await exportPdf(reopenedProject));
  const annotations = output.getPage(0).node.Annots()!;
  const importedOut = annotations.lookup(0, PDFDict);
  expect(importedOut.lookup(PDFName.of("T"), PDFHexString).decodeText()).toBe("Updated");
  expect(importedOut.lookup(PDFName.of("StateModel"), PDFString).decodeText()).toBe("Review");
  expect(importedOut.lookup(PDFName.of("State"), PDFString).decodeText()).toBe("Accepted");
  expect(importedOut.lookup(PDFName.of("CustomFlag"), PDFString).decodeText()).toBe("preserve");
  const noteOut = annotations.lookup(1, PDFDict);
  expect(noteOut.lookup(PDFName.of("T"), PDFHexString).decodeText()).toBe("Reviewer");
  expect(noteOut.lookup(PDFName.of("State"), PDFString).decodeText()).toBe("Completed");
});

it("limits review states to Text annotations and preserves unrelated metadata", async () => {
  const pdf = await PDFDocument.create();
  const text = pdf.context.obj({ Subtype: "Text", Custom: "keep" }) as PDFDict;
  writeCommentMetadata(text, { author: "A", reviewStatus: "Rejected" });
  expect(text.lookup(PDFName.of("T"), PDFHexString).decodeText()).toBe("A");
  expect(text.get(PDFName.of("Custom"))).toBe(PDFName.of("keep"));
  const highlight = pdf.context.obj({ Subtype: "Highlight" }) as PDFDict;
  expect(() => writeCommentMetadata(highlight, { reviewStatus: "Accepted" })).toThrow();
  expect(highlight.get(PDFName.of("State"))).toBeUndefined();
});

it("lists added markup comments and preserves their edited author and contents in PDF output", async () => {
  const model = emptyDocument("markup-comments.pdf");
  model.pages = [blankPage()];
  model.pages[0].objects = ["highlight", "underline", "strike", "ink"].map((kind, index) => ({
    ...newObject(kind as "highlight" | "underline" | "strike" | "ink", 40, 60 + index * 30),
    text: `確認 ${index}`, author: "日本語レビュー",
    ...(kind === "ink" ? { points: [{ x: 0, y: 0 }, { x: 15, y: 10 }] } : {}),
  }));
  const rows = buildComments(model, []);
  expect(rows).toHaveLength(4);
  expect(rows.map(row => row.subtype)).toEqual(["Highlight", "Underline", "StrikeOut", "Ink"]);
  expect(filterComments(rows, { query: "", author: "", status: "", pageId: "", subtype: "xfdf" })).toHaveLength(4);
  expect(filterComments(rows, { query: "", author: "", status: "", pageId: "", subtype: "Ink" })).toHaveLength(1);
  expect(rows.every(row => row.added && row.editable && !row.reviewable)).toBe(true);
  expect(filterComments(rows, { query: "確認", author: "日本語レビュー", status: "", pageId: "" })).toHaveLength(4);
  const output = await PDFDocument.load(await exportPdf(model));
  const annotations = output.getPage(0).node.Annots()!;
  expect(annotations.size()).toBe(4);
  for (let index = 0; index < annotations.size(); index++) {
    const annotation = annotations.lookup(index, PDFDict);
    expect(annotation.lookup(PDFName.of("T"), PDFHexString).decodeText()).toBe("日本語レビュー");
    expect(annotation.lookup(PDFName.of("Contents"), PDFHexString).decodeText()).toBe(`確認 ${index}`);
    expect(annotation.has(PDFName.of("State"))).toBe(false);
  }
});
