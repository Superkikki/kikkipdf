import { describe, expect, it } from "vitest";
import { PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { openProject, saveProject } from "../src/state/project";
import { importPdf, releasePdfs } from "../src/viewer/pdf";
import { History } from "../src/commands/history";
import { batchPageCommand } from "../src/pages/batchOperations";
import { exportPdf } from "../src/export/engine";
import { mergeDocuments } from "../src/commands/document";

GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;
import { emptyDocument, blankPage } from "../src/state/model";
import { pageLabel, generatePageLabels, setPageLabels, clearPageLabels, findPageByLabel } from "../src/pages/labels";
import { writePageLabels } from "../src/pages/pdfPageLabels";

describe("logical page labels", () => {
  it("formats decimal, Roman, repeated-letter and prefix labels", () => {
    expect(generatePageLabels(3, { style: "D", prefix: "p-", start: 8 })).toEqual(["p-8", "p-9", "p-10"]);
    expect(generatePageLabels(4, { style: "R", prefix: "", start: 4 })).toEqual(["IV", "V", "VI", "VII"]);
    expect(generatePageLabels(4, { style: "r", prefix: "", start: 1 })).toEqual(["i", "ii", "iii", "iv"]);
    expect(generatePageLabels(28, { style: "A", prefix: "", start: 1 }).slice(-3)).toEqual(["Z", "AA", "BB"]);
    expect(generatePageLabels(2, { style: "a", prefix: "付録 ", start: 26 })).toEqual(["付録 z", "付録 aa"]);
    expect(generatePageLabels(2, { style: "", prefix: "表-", start: 1 })).toEqual(["表-", "表-"]);
  });

  it("validates ranges and limits without producing control characters", () => {
    for (const options of [
      { style: "D" as const, prefix: "", start: 0 },
      { style: "D" as const, prefix: "", start: 1_000_001 },
      { style: "R" as const, prefix: "", start: 4000 },
      { style: "" as const, prefix: "", start: 1 },
      { style: "D" as const, prefix: "x".repeat(129), start: 1 },
      { style: "D" as const, prefix: "bad\n", start: 1 },
    ]) expect(() => generatePageLabels(1, options)).toThrow();
    expect(generatePageLabels(513, { style: "D", prefix: "", start: 1 })).toHaveLength(513);
    expect(() => generatePageLabels(1, { style: "A", prefix: "x".repeat(128), start: 13313 })).toThrow();
  });

  it("uses physical numbering as fallback and applies undoable labels to sorted indices", () => {
    const document = emptyDocument();
    document.pages = [blankPage(), blankPage(), blankPage()];
    document.pages[1].label = "iv";
    expect(document.pages.map(pageLabel)).toEqual(["1", "iv", "3"]);
    const command = setPageLabels([2, 0], { style: "A", prefix: "", start: 1 });
    const changed = command.apply(document);
    expect(changed.pages.map((page) => page.label)).toEqual(["A", "iv", "B"]);
    expect(command.apply(changed)).toBe(changed);
    expect(clearPageLabels([0, 2]).apply(changed).pages.map((page) => page.label)).toEqual([undefined, "iv", undefined]);
    expect(() => setPageLabels([3], { style: "D", prefix: "", start: 1 }).apply(document)).toThrow();
  });

  it("keeps labels attached to pages through history, duplication and reordering", () => {
    const document = emptyDocument();
    document.pages = [blankPage(), blankPage(), blankPage()];
    document.pages[0].label = "cover";
    const history = new History(document);
    history.execute(batchPageCommand([document.pages[0].id], "duplicate"));
    expect(history.current.document.pages.map((page) => page.label)).toEqual(["cover", "cover", undefined, undefined]);
    history.undo();
    expect(history.current.document).toBe(document);
    history.redo();
    const ids = history.current.document.pages.map((page) => page.id);
    history.execute(batchPageCommand([ids[0], ids[3]], "reverse"));
    expect(history.current.document.pages.map((page) => page.label)).toEqual([undefined, "cover", undefined, "cover"]);
  });

  it("undoes and redoes label changes, and resolves duplicate labels exactly", () => {
    const document = emptyDocument();
    document.pages = [blankPage(), blankPage(), blankPage()];
    document.pages[0].label = "A";
    document.pages[1].label = "A";
    document.pages[2].label = "a";
    expect(findPageByLabel(document.pages, "A", 1)).toBe(1);
    expect(findPageByLabel(document.pages, "A", 2)).toBe(0);
    expect(findPageByLabel(document.pages, "a", 0)).toBe(2);
    expect(findPageByLabel(document.pages, "missing", 0)).toBe(-1);
    const history = new History(document);
    history.execute(setPageLabels([0, 1], { style: "D", prefix: "章-", start: 1 }));
    expect(history.current.document.pages.map((page) => page.label)).toEqual(["章-1", "章-2", "a"]);
    history.undo();
    expect(history.current.document.pages.map((page) => page.label)).toEqual(["A", "A", "a"]);
    history.redo();
    history.execute(clearPageLabels([0, 1]));
    expect(history.current.document.pages.map((page) => page.label)).toEqual([undefined, undefined, "a"]);
    history.undo();
    expect(history.current.document.pages.map((page) => page.label)).toEqual(["章-1", "章-2", "a"]);
  });

  it("retains page labels when documents are merged", () => {
    const document = emptyDocument();
    document.pages = [blankPage()];
    document.pages[0].label = "本文-1";
    const additional = emptyDocument();
    additional.pages = [blankPage(), blankPage()];
    additional.pages[0].label = "appendix-a";
    const merged = mergeDocuments(additional).apply(document);
    expect(merged.pages.map((page) => page.label)).toEqual(["本文-1", "appendix-a", undefined]);
  });

  it("writes labels for reordered output pages and omits the catalog entry when none are labeled", async () => {
    const document = emptyDocument();
    document.pages = [blankPage(), blankPage(), blankPage()];
    document.pages[0].label = "Cover";
    document.pages[2].label = "iv";
    const pdf = await PDFDocument.create();
    pdf.addPage(); pdf.addPage(); pdf.addPage();
    writePageLabels(pdf, [document.pages[2], document.pages[1], document.pages[0]]);
    const saved = await PDFDocument.load(await pdf.save());
    expect(saved.catalog.has(PDFName.of("PageLabels"))).toBe(true);
    const loading = getDocument({ data: await saved.save() });
    const parsed = await loading.promise;
    expect(await parsed.getPageLabels()).toEqual(["iv", "2", "Cover"]);
    await loading.destroy();

    const unlabeled = await PDFDocument.create();
    unlabeled.addPage();
    writePageLabels(unlabeled, [blankPage()]);
    expect(unlabeled.catalog.has(PDFName.of("PageLabels"))).toBe(false);
  });

  it("preserves labels in editable projects and imports an existing PDF number tree", async () => {
    const model = emptyDocument();
    model.pages = [blankPage(), blankPage(), blankPage()];
    model.pages[0].label = "表紙";
    model.pages[1].label = "iv";
    const reopened = await openProject(await saveProject(model));
    expect(reopened.pages.map((page) => page.label)).toEqual(["表紙", "iv", undefined]);

    const source = await PDFDocument.create();
    source.addPage(); source.addPage(); source.addPage();
    const nums = source.context.obj([
      0, source.context.register(source.context.obj({ S: "r", P: PDFHexString.fromText("pre-"), St: 4 })),
      2, source.context.register(source.context.obj({ S: "D", St: 1 })),
    ]);
    source.catalog.set(PDFName.of("PageLabels"), source.context.register(source.context.obj({ Nums: nums })));
    const imported = await importPdf({ name: "labeled.pdf", bytes: await source.save() });
    expect(imported.pages.map((page) => page.label)).toEqual(["pre-iv", "pre-v", "1"]);
    releasePdfs();
  });

  it("exports subset labels in output order and reads number trees with more than 64 entries", async () => {
    const model = emptyDocument();
    model.pages = Array.from({ length: 70 }, (_, i) => ({ ...blankPage(), label: `P${i + 1}` }));
    const bytes = await exportPdf(model, undefined, { indices: [69, 2, 41] });
    const loading = getDocument({ data: bytes });
    const pdf = await loading.promise;
    expect(await pdf.getPageLabels()).toEqual(["P70", "P3", "P42"]);
    await loading.destroy();

    const many = await PDFDocument.create();
    const pages = Array.from({ length: 70 }, () => blankPage());
    pages.forEach((page, i) => { page.label = `L${i + 1}`; many.addPage(); });
    writePageLabels(many, pages);
    const large = getDocument({ data: await many.save() });
    expect(await (await large.promise).getPageLabels()).toEqual(pages.map((page) => page.label));
    await large.destroy();

    const invalid = await PDFDocument.create();
    invalid.addPage();
    expect(() => writePageLabels(invalid, [{ ...blankPage(), label: "bad\u0001" }])).toThrow();
  });
});
