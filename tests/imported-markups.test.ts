import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, decodePDFRawStream } from "pdf-lib";
import { addImportedMarkups, importedMarkupsSchema, removeImportedMarkup, updateImportedMarkup } from "../src/annotations/importedMarkup";
import { History } from "../src/commands/history";
import { duplicatePage } from "../src/commands/document";
import { blankPage, emptyDocument, newObject, type ImportedMarkup } from "../src/state/model";
import { openProject, saveProject } from "../src/state/project";
import { exportPdf } from "../src/export/engine";
import { ImportedMarkupOverlay } from "../src/annotations/ImportedMarkupOverlay";
import { commentsXfdf } from "../src/annotations/commentXfdf";
import { buildComments } from "../src/annotations/comments";

const note = (id = "note"): ImportedMarkup => ({
  id, name: "original-XFDF-name", subtype: "Text", x: 10, y: 20, width: 24, height: 30,
  text: "日本語 & <内容>\n次行", author: "著者", reviewStatus: "Accepted", color: "#336699",
  opacity: 0.4, strokeWidth: 0, icon: "Help", date: "D:20261005120000+09'00'",
  creationDate: "D:20261001100000Z", subject: "確認", flags: 4,
});
function model() {
  const document = emptyDocument("import.pdf");
  document.pages = [blankPage(), blankPage()];
  return document;
}
function numbers(dict: PDFDict, key: string) {
  const values = dict.lookup(PDFName.of(key), PDFArray);
  return Array.from({ length: values.size() }, (_, i) => values.lookup(i, PDFNumber).asNumber());
}
function text(dict: PDFDict, key: string) {
  const value = dict.lookup(PDFName.of(key));
  if (!(value instanceof PDFHexString || value instanceof PDFString)) throw Error(`Missing ${key}`);
  return value.decodeText();
}
function appearance(dict: PDFDict) {
  const stream = dict.lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of("N"));
  if (!(stream instanceof PDFRawStream)) throw Error("Missing appearance stream");
  return { stream, content: new TextDecoder().decode(decodePDFRawStream(stream).decode()) };
}

describe("imported markup commands and project", () => {
  it("imports across pages as one immutable undo step, then edits/deletes independently", () => {
    const document = model(), history = new History(document);
    const input = note(), command = addImportedMarkups([
      { pageId: document.pages[0].id, markup: input },
      { pageId: document.pages[1].id, markup: note("second") },
    ]);
    input.text = "Changed after command creation";
    history.execute(command);
    const imported = history.current.document;
    expect(imported.pages[0].importedMarkups?.[0].text).toBe("日本語 & <内容>\n次行");
    expect(document.pages.every(page => page.importedMarkups === undefined)).toBe(true);
    expect(history.dirty).toBe(true);
    history.undo();
    expect(history.current.document).toBe(document);
    expect(history.canUndo).toBe(false);
    expect(history.dirty).toBe(false);
    history.redo();
    expect(history.current.document).toBe(imported);
    history.execute(updateImportedMarkup(document.pages[0].id, "note", { text: "Edited", reviewStatus: "Completed" }));
    expect(history.current.document.pages[0].importedMarkups?.[0].reviewStatus).toBe("Completed");
    expect(imported.pages[0].importedMarkups?.[0].text).toBe("日本語 & <内容>\n次行");
    history.execute(removeImportedMarkup(document.pages[0].id, "note"));
    expect(history.current.document.pages[0].importedMarkups).toEqual([]);
    expect(history.current.document.pages[1].importedMarkups).toHaveLength(1);
    history.undo();
    expect(history.current.document.pages[0].importedMarkups?.[0].text).toBe("Edited");
  });

  it("rejects missing pages and duplicate IDs without creating a partial revision", () => {
    const document = model(), history = new History(document);
    expect(() => history.execute(addImportedMarkups([
      { pageId: document.pages[0].id, markup: note() },
      { pageId: "missing", markup: note("missing") },
    ]))).toThrow("ページ");
    expect(history.current.document).toBe(document);
    expect(history.canUndo).toBe(false);
    expect(() => history.execute(addImportedMarkups([
      { pageId: document.pages[0].id, markup: note() },
      { pageId: document.pages[0].id, markup: note() },
    ]))).toThrow();
    expect(history.current.document).toBe(document);
    expect(history.dirty).toBe(false);
  });

  it("gives duplicated-page markups new IDs while preserving geometry and source metadata", async () => {
    const document = model();
    document.pages[0].importedMarkups = [note()];
    const history = new History(document);
    history.execute(duplicatePage(document.pages[0].id));
    const original = history.current.document.pages[0].importedMarkups![0];
    const duplicate = history.current.document.pages[1].importedMarkups![0];
    expect(duplicate.id).not.toBe(original.id);
    expect({ ...duplicate, id: original.id }).toEqual(original);
    const pdf = await PDFDocument.load(await exportPdf(history.current.document));
    const annotation = (page: number) => pdf.getPage(page).node.lookup(PDFName.of("Annots"), PDFArray).lookup(0, PDFDict);
    expect(text(annotation(0), "NM")).toBe(original.id);
    expect(text(annotation(1), "NM")).toBe(duplicate.id);
    history.undo();
    expect(history.current.document).toBe(document);
  });

  it("round-trips markup metadata/geometry in version 1 and opens old projects without the optional field", async () => {
    const document = model();
    document.pages[0].importedMarkups = [note(), { ...note("ink"), subtype: "Ink", gestures: [[{ x: 12, y: 14 }]], color: null }];
    const bytes = await saveProject(document);
    expect((await openProject(bytes)).pages).toEqual(document.pages);
    const files = unzipSync(bytes), meta = JSON.parse(strFromU8(files["document.json"]));
    expect(meta.version).toBe(1);
    delete meta.document.pages[0].importedMarkups;
    files["document.json"] = strToU8(JSON.stringify(meta));
    const legacy = await openProject(zipSync(files));
    expect(legacy.pages[0].importedMarkups).toBeUndefined();
    expect(legacy.pages[0].objects).toEqual([]);
  });

  it("rejects malformed geometry, illegal flags and page point budget overflow in project/schema", async () => {
    const document = model();
    document.pages[0].importedMarkups = [note()];
    const files = unzipSync(await saveProject(document));
    for (const patch of [{ x: 1000001 }, { width: 0 }, { flags: 1024 },
      { subtype: "Ink", gestures: [[]] }, { subtype: "Highlight", quadPoints: [{ x: 0, y: 0 }] }]) {
      const meta = JSON.parse(strFromU8(files["document.json"]));
      Object.assign(meta.document.pages[0].importedMarkups[0], patch);
      await expect(openProject(zipSync({ ...files, "document.json": strToU8(JSON.stringify(meta)) }))).rejects.toThrow();
    }
    const gesture = Array.from({ length: 50001 }, () => ({ x: 0, y: 0 }));
    expect(importedMarkupsSchema.safeParse([
      { ...note("a"), subtype: "Ink", gestures: [gesture] },
      { ...note("b"), subtype: "Ink", gestures: [gesture] },
    ]).success).toBe(false);
  });
});

describe("imported markup PDF writer", () => {
  it("omits transparent/hidden SVGs and renders single-point Ink with a visible radius", () => {
    const page = blankPage();
    page.importedMarkups = [note("visible"), { ...note("transparent"), color: null },
      ...[1, 2, 32].map(flags => ({ ...note(`flag-${flags}`), flags })),
      { ...note("dot"), subtype: "Ink", gestures: [[{ x: 15, y: 30 }]], strokeWidth: 0 }];
    const svg = renderToStaticMarkup(createElement(ImportedMarkupOverlay, { page }));
    expect(svg).toContain('data-imported-markup-id="visible"');
    expect(svg).toContain('data-imported-markup-id="dot"');
    expect(svg).not.toContain('data-imported-markup-id="transparent"');
    expect(svg).not.toContain('data-imported-markup-id="flag-');
    expect(svg).toContain('<circle cx="15" cy="30" r="0.5"');
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('<rect x="10" y="20" width="24" height="30"');
    expect(svg).toMatch(/clip-path="url\(#[^)]+\)"/);
    const twoCopies = renderToStaticMarkup(createElement("div", null,
      createElement(ImportedMarkupOverlay, { page }), createElement(ImportedMarkupOverlay, { page })));
    const clipIds = [...twoCopies.matchAll(/<clipPath id="([^"]+)"/g)].map(match => match[1]);
    expect(clipIds).toHaveLength(4);
    expect(new Set(clipIds).size).toBe(4);
  });

  it("preserves arbitrary quads, multi/single Ink, metadata and raw CropBox origin through rotation/edit crop", async () => {
    const source = await PDFDocument.create(), sourcePage = source.addPage([400, 500]);
    sourcePage.setCropBox(20, 30, 350, 450);
    const bytes = await source.save(), sourceSnapshot = bytes.slice(), document = model();
    document.sources.source = { id: "source", name: "source.pdf", bytes };
    const quad: ImportedMarkup = { ...note("highlight"), subtype: "Highlight", x: 5, y: 10, width: 100, height: 60,
      quadPoints: [{ x: 7, y: 12 }, { x: 102, y: 17 }, { x: 9, y: 47 }, { x: 100, y: 54 }] };
    const ink: ImportedMarkup = { ...note("ink"), subtype: "Ink", x: 5, y: 10, width: 100, height: 60,
      gestures: [[{ x: 20, y: 30 }, { x: 50, y: 40 }, { x: 70, y: 50 }], [{ x: 60, y: 45 }]] };
    document.pages = [{ ...blankPage(), sourceId: "source", sourceIndex: 0, width: 350, height: 450, rotation: 90,
      crop: { x: 5, y: 10, width: 300, height: 400 },
      importedMarkups: [note(), quad, { ...quad, id: "underline", subtype: "Underline" }, { ...quad, id: "strike", subtype: "StrikeOut" }, ink] }];
    const exported = await PDFDocument.load(await exportPdf(document)), page = exported.getPage(0);
    expect(document.sources.source.bytes).toEqual(sourceSnapshot);
    expect(page.getRotation().angle).toBe(90);
    expect(page.getCropBox()).toEqual({ x: 25, y: 70, width: 300, height: 400 });
    const annots = page.node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(5);
    const [textNote, highlight, underline, strike, inkAnnot] = Array.from({ length: 5 }, (_, i) => annots.lookup(i, PDFDict));
    expect(numbers(textNote, "Rect")).toEqual([30, 430, 54, 460]);
    expect(text(textNote, "NM")).toBe("note");
    expect(text(textNote, "Contents")).toBe(note().text);
    expect(text(textNote, "T")).toBe("著者");
    expect(text(textNote, "StateModel")).toBe("Review");
    expect(text(textNote, "State")).toBe("Accepted");
    expect(text(textNote, "M")).toBe(note().date);
    expect(text(textNote, "CreationDate")).toBe(note().creationDate);
    expect(text(textNote, "Subj")).toBe("確認");
    expect(textNote.lookup(PDFName.of("Name"), PDFName).decodeText()).toBe("Help");
    expect(textNote.lookup(PDFName.of("F"), PDFNumber).asNumber()).toBe(4);
    expect(textNote.lookup(PDFName.of("CA"), PDFNumber).asNumber()).toBe(0.4);
    for (const annotation of [highlight, underline, strike]) {
      expect(numbers(annotation, "Rect")).toEqual([25, 410, 125, 470]);
      expect(numbers(annotation, "QuadPoints")).toEqual([27, 468, 122, 463, 29, 433, 120, 426]);
    }
    expect(appearance(highlight).content).toContain("2 58 m 97 53 l 95 16 l 4 23 l h f");
    expect(appearance(underline).content).toContain("4 23 m 95 16 l S");
    expect(appearance(strike).content).toContain("3 40.5 m 96 34.5 l S");
    const list = inkAnnot.lookup(PDFName.of("InkList"), PDFArray);
    expect(list.size()).toBe(2);
    const gestureNumbers = (i: number) => {
      const values = list.lookup(i, PDFArray);
      return Array.from({ length: values.size() }, (_, j) => values.lookup(j, PDFNumber).asNumber());
    };
    expect(gestureNumbers(0)).toEqual([40, 450, 70, 440, 90, 430]);
    expect(gestureNumbers(1)).toEqual([80, 435]);
    const inkAp = appearance(inkAnnot);
    expect(inkAp.content).toContain("0 w");
    expect(inkAp.content).toContain("15 40 m\n45 30 l\n65 20 l\nS");
    expect(inkAp.content).toContain("55.5 25 m");
    expect(inkAp.content.match(/ c/g)).toHaveLength(4);
    expect(inkAp.content).toContain("c f");
    expect(numbers(inkAp.stream.dict, "BBox")).toEqual([0, 0, 100, 60]);
  });

  it("keeps null color transparent with an empty AP and emits distinct NM for imported and ordinary notes", async () => {
    const document = model();
    document.pages[0].importedMarkups = [{ ...note("transparent"), color: null }];
    document.pages[0].objects = [{ ...newObject("note", 10, 20), id: "ordinary", text: "Regular note" }];
    const pdf = await PDFDocument.load(await exportPdf(document));
    const annotations = pdf.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const imported = annotations.lookup(0, PDFDict), ordinary = annotations.lookup(1, PDFDict);
    expect(numbers(imported, "C")).toEqual([]);
    expect(appearance(imported).content).not.toMatch(/\bre\b|\bm\b|\bl\b|\bf\b|\bS\b/);
    expect(text(imported, "Contents")).toBe(note().text);
    expect(text(imported, "NM")).toBe("transparent");
    expect(text(ordinary, "NM")).toBe("ordinary");
  });

  it("re-exports imported blank/source-page comments to XFDF with metadata, multiple quads/Ink and unique IDs", async () => {
    const source = await PDFDocument.create();
    source.addPage([400, 500]).setCropBox(20, 30, 350, 450);
    const document = model();
    document.sources.source = { id: "source", name: "source.pdf", bytes: await source.save() };
    document.pages[0] = { ...document.pages[0], width: 350, height: 450 };
    document.pages[1] = { ...document.pages[1], sourceId: "source", sourceIndex: 0, width: 350, height: 450, rotation: 90,
      crop: { x: 10, y: 10, width: 300, height: 400 } };
    document.pages[0].importedMarkups = [note("blank-note")];
    document.pages[1].importedMarkups = [{ ...note("source-note"), flags: 4 | 64 | 128 },
      { ...note("transparent"), color: null },
      { ...note("multi-quad"), subtype: "Highlight", quadPoints: [
        { x: 10, y: 20 }, { x: 30, y: 22 }, { x: 11, y: 30 }, { x: 31, y: 33 },
        { x: 12, y: 40 }, { x: 32, y: 41 }, { x: 13, y: 50 }, { x: 33, y: 52 },
      ] },
      { ...note("multi-ink"), subtype: "Ink", gestures: [
        [{ x: 10, y: 20 }, { x: 20, y: 30 }], [{ x: 15, y: 25 }],
      ] },
    ];
    const rows = buildComments(document, []);
    expect(rows.every(row => row.importedMarkup && !row.added && row.editable)).toBe(true);
    const xml = new TextDecoder().decode(await commentsXfdf(document, rows));
    const tags = [...xml.matchAll(/<(text|highlight|ink)\b([^>]*)>/g)].map(match => ({ kind: match[1], attrs: match[2] }));
    expect(tags).toHaveLength(5);
    expect(tags[0].attrs).toContain('rect="10,400,34,430"');
    expect(tags[0].attrs).toContain('page="0"');
    expect(tags[1].attrs).toContain('rect="30,430,54,460"');
    expect(tags[1].attrs).toContain('page="1"');
    expect(tags[1].attrs).toContain('title="著者"');
    expect(tags[1].attrs).toContain('subject="確認"');
    expect(tags[1].attrs).toContain('date="D:20261005120000+09&apos;00&apos;"');
    expect(tags[1].attrs).toContain('creationdate="D:20261001100000Z"');
    expect(tags[1].attrs).toContain('flags="print,readonly,locked"');
    expect(tags[1].attrs).toContain('icon="Help"');
    expect(tags[1].attrs).toContain('statemodel="Review" state="Accepted"');
    expect(tags[2].attrs).toContain('color=""');
    expect(tags[3].attrs).toContain('coords="30,460,50,458,31,450,51,447,32,440,52,439,33,430,53,428"');
    expect(tags[3].attrs).toContain('width="0"');
    expect(xml).toContain('<inklist><gesture>30,460;40,450</gesture><gesture>35,455</gesture></inklist>');
    expect(xml).toContain('日本語 &amp; &lt;内容&gt;&#10;次行');
    const names = tags.map(tag => tag.attrs.match(/\bname="([^"]+)"/)![1]);
    expect(names).toEqual(["blank-note", "source-note", "transparent", "multi-quad", "multi-ink"]);
    expect(new Set(names).size).toBe(5);

    // After PDF export/reopen, the source-annotation route retains empty C as color="".
    const exported = await exportPdf(document), pdf = await PDFDocument.load(exported);
    const reopened = model();
    reopened.sources.saved = { id: "saved", name: "saved.pdf", bytes: exported };
    reopened.pages = [{ ...blankPage(), sourceId: "saved", sourceIndex: 1, width: 350, height: 450 }];
    const reference = pdf.getPage(1).node.lookup(PDFName.of("Annots"), PDFArray).get(1);
    if (!(reference instanceof PDFRef)) throw Error("Missing annotation reference");
    const sourceXml = new TextDecoder().decode(await commentsXfdf(reopened, [{
      ...rows[2], id: `${reference.objectNumber}R${reference.generationNumber || ""}`,
      pageId: reopened.pages[0].id, pageIndex: 0, importedMarkup: false,
    }]));
    expect(sourceXml).toContain('color=""');
    expect(sourceXml).toContain('name="transparent"');
  });
});
