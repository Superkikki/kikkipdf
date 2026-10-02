import { describe, expect, it } from "vitest";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  StandardFonts,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { parseContent } from "../src/direct/parser";
import { unicodeMap } from "../src/direct/cmap";
import {
  analyzePage,
  inspectDirectText,
  rewrittenContent,
} from "../src/direct/content";
import { boundedDecode } from "../src/direct/pdfFonts";
import { directTextObject } from "../src/direct/editor";
import { directReferences } from "../src/direct/model";
import {
  blankPage,
  emptyDocument,
  type DocumentModel,
} from "../src/state/model";
import { exportPdf } from "../src/export/engine";
import { History } from "../src/commands/history";
import {
  addObject,
  deleteObject,
  duplicatePage,
  revertDirectText,
  updateObject,
} from "../src/commands/document";
import { pasteObject } from "../src/editor/objectActions";
import { openProject, saveProject } from "../src/state/project";
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (s: Uint8Array) => new TextDecoder().decode(s);
const content =
  "BT /F1 20 Tf 1 0 0 1 40 300 Tm (UNIQUE_original_text) Tj ( Following) Tj ET";
async function fixture(commands = content) {
  const doc = await PDFDocument.create(),
    page = doc.addPage([420, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.node.set(
    PDFName.of("Resources"),
    doc.context.obj({ Font: { F1: font.ref } }),
  );
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(doc.context.flateStream(enc(commands))),
  );
  return fromBytes(await doc.save());
}
function fromBytes(bytes: Uint8Array): DocumentModel {
  const d = emptyDocument("source.pdf");
  d.sources.s = { id: "s", name: "source.pdf", bytes };
  d.pages = [
    { ...blankPage(), width: 420, height: 400, sourceId: "s", sourceIndex: 0 },
  ];
  return d;
}
async function inspect(d: DocumentModel) {
  return inspectDirectText(d.sources.s.bytes, 0);
}
async function edit(d: DocumentModel, text = "UNIQUE_original_text") {
  const inspection = await inspect(d),
    run = inspection.runs.find((r) => r.text === text);
  if (!run) throw Error(JSON.stringify(inspection));
  const object = directTextObject(inspection, d.pages[0], text, run);
  object.text = "Replaced";
  return addObject(d.pages[0].id, object).apply(d);
}
async function allStreams(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .flatMap(([, o]) =>
      o instanceof PDFRawStream ? [dec(boundedDecode(o))] : [],
    );
}
describe("bounded PDF content and ToUnicode parsing", () => {
  it("handles escaped/nested strings, octal, hex padding, comments and byte offsets", () => {
    const input =
      "% comment\r\n(A\\050B\\051\\n\\101\\\r\n(C)) Tj [<4142F> -12.5 (D)] TJ /F#31 18 Tf";
    const ops = parseContent(enc(input));
    expect(dec(ops[0].args[0] as Uint8Array)).toBe("A(B)\nA(C)");
    expect(ops[1].args[0]).toEqual([
      new Uint8Array([65, 66, 240]),
      -12.5,
      enc("D"),
    ]);
    expect(ops[2].args[0]).toEqual({ name: "F1" });
    expect(input.slice(ops[0].start, ops[0].end)).toContain("Tj");
  });
  it("refuses malformed operands, binary inline images and excessive nesting", () => {
    for (const s of [
      "(unfinished Tj",
      "[1 2 TJ",
      "<XY> Tj",
      "<< /A 1 /A 2 >> BDC",
      "123",
      "BI /W 1 ID xyz EI",
      "[".repeat(34) + "0" + "]".repeat(34) + " TJ",
    ])
      expect(() => parseContent(enc(s))).toThrow();
  });
  it("decodes bfchar, bfrange, arrays, ligatures and surrogate pairs", () => {
    const map = unicodeMap(
      enc(
        "3 beginbfchar <0001> <65E5> <0002> <00660069> <0003> <D83DDE00> endbfchar 2 beginbfrange <0004> <0005> <0041> <0006> <0007> [<672C> <8A9E>] endbfrange",
      ),
    );
    expect([...map.values()]).toEqual(["日", "fi", "😀", "A", "B", "本", "語"]);
    expect(() => unicodeMap(enc("/Other usecmap"))).toThrow();
    expect(() =>
      unicodeMap(enc("1 beginbfchar <0001> <D800> endbfchar")),
    ).toThrow();
  });
  it("rejects repeated/unfinished CMap ranges, invalid counts and invalid UTF-16 ranges", () => {
    for (const input of [
      "2 beginbfchar <0001> <0041> endbfchar",
      "1 beginbfchar <0001> <0041>",
      "2 beginbfrange <0001> <FFFF> <0000> <0001> <FFFF> <0000> endbfrange",
      "1 beginbfrange <0001> <0002> <D800> endbfrange",
    ])
      expect(() => unicodeMap(enc(input))).toThrow();
  });
});
describe("original glyph removal with preserved text advance", () => {
  it("refuses UserUnit scaling and never guesses TrueType widths from its base name", async () => {
    const d = await fixture();
    const pdf = await PDFDocument.load(d.sources.s.bytes),
      p = pdf.getPage(0);
    p.node.set(PDFName.of("UserUnit"), pdf.context.obj(2));
    expect(
      (await inspectDirectText(await pdf.save(), 0)).unsupported,
    ).toContain("UserUnit");
    p.node.delete(PDFName.of("UserUnit"));
    const font = p.node
      .Resources()!
      .lookup(PDFName.of("Font"), PDFDict)
      .lookup(PDFName.of("F1"), PDFDict);
    font.set(PDFName.of("Subtype"), PDFName.of("TrueType"));
    expect((await inspectDirectText(await pdf.save(), 0)).runs).toEqual([]);
  });
  it("preserves exact stream boundaries and refuses split tokens or comments", async () => {
    for (const [parts, supported] of [
      [["BT /F1 20 Tf 1 0 0 1 40 300 Tm\n", "(A) Tj\n", "ET\n"], true],
      [["BT /F1 20 Tf 1 0 0 1 40 300 Tm\n", "(A", ") Tj ET"], false],
      [["BT /F1 20 Tf 1 0 0 1 40 300 Tm %comment", "(A) Tj\nET"], false],
    ] as const) {
      const d = await fixture(),
        pdf = await PDFDocument.load(d.sources.s.bytes),
        p = pdf.getPage(0);
      p.node.set(
        PDFName.of("Contents"),
        pdf.context.obj(
          parts.map((s) =>
            pdf.context.register(pdf.context.flateStream(enc(s))),
          ),
        ),
      );
      const bytes = await pdf.save(),
        result = await inspectDirectText(bytes, 0);
      expect(result.runs.length > 0).toBe(supported);
      if (supported) {
        const original = await analyzePage(
          (await PDFDocument.load(bytes)).getPage(0),
          0,
        );
        expect(dec(original.bytes)).toBe(parts.join(""));
      }
    }
  });
  it("removes original string operands and orphan source streams, with no mask", async () => {
    const d = await edit(await fixture()),
      bytes = await exportPdf(d);
    const streams = await allStreams(bytes);
    expect(streams.join("\n")).not.toContain("UNIQUE_original_text");
    expect(streams.join("\n")).not.toContain(
      Buffer.from("UNIQUE_original_text").toString("hex").toUpperCase(),
    );
    const output = await PDFDocument.load(bytes),
      runs = (await analyzePage(output.getPage(0), 0)).runs;
    expect(runs.map((r) => r.text)).toEqual([" Following", "Replaced"]);
    expect(streams.join("\n")).not.toMatch(/\bre\b/);
  });
  it("preserves following glyph positions for Tj/TJ, character/word spacing, scaling and quotes", async () => {
    for (const commands of [
      "BT /F1 18 Tf 2 Tc 4 Tw 85 Tz 1 0 0 1 40 300 Tm (A B) Tj (Following) Tj ET",
      "BT /F1 18 Tf 1 0 0 1 40 300 Tm [(A) -200 ( B) 50] TJ (Following) Tj ET",
      "BT /F1 18 Tf 24 TL 1 0 0 1 40 300 Tm (Before) Tj (A B) ' (Following) Tj ET",
      'BT /F1 18 Tf 24 TL 1 0 0 1 40 300 Tm (Before) Tj 3 2 (A B) " (Following) Tj ET',
      "q 1.2 0 0 1.2 10 20 cm BT /F1 18 Tf 2 Ts 1 0 0 1 40 250 Tm (A B) Tj (Following) Tj ET Q",
    ]) {
      const d = await fixture(commands),
        input = await PDFDocument.load(d.sources.s.bytes);
      const original = await analyzePage(input.getPage(0), 0),
        target = original.runs.find((r) => r.text === "A B")!;
      expect(target).toBeDefined();
      const changed = await rewrittenContent(input.getPage(0), 0, [
        { ...target.reference, sourceId: "s" },
      ]);
      input
        .getPage(0)
        .node.set(
          PDFName.of("Contents"),
          input.context.register(input.context.flateStream(changed)),
        );
      const result = await analyzePage(
        (await PDFDocument.load(await input.save())).getPage(0),
        0,
      );
      const before = original.runs.find((r) => r.text === "Following")!,
        after = result.runs.find((r) => r.text === "Following")!;
      expect(after.x).toBeCloseTo(before.x, 7);
      expect(after.y).toBeCloseTo(before.y, 7);
      expect(after.fontSize).toBeCloseTo(before.fontSize, 7);
      expect(result.runs.some((r) => r.text === "A B")).toBe(false);
    }
  });
  it("supports Identity-H Japanese CID fonts and source CropBox origins", async () => {
    const fontBytes = new Uint8Array(
      await readFile("public/assets/NotoSansJP-Regular.otf"),
    );
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const p = doc.addPage([500, 500]),
      font = await doc.embedFont(fontBytes, { subset: false });
    p.drawText("日本語を直接編集", { x: 60, y: 350, size: 20, font });
    p.setCropBox(20, 30, 420, 400);
    const d = fromBytes(await doc.save()),
      runs = await inspect(d);
    expect(runs.runs[0].text).toBe("日本語を直接編集");
    expect(runs.runs[0].x).toBe(40);
    expect(runs.runs[0].baseline).toBe(80);
    const edited = await edit(d, "日本語を直接編集");
    edited.pages[0].objects[0].text = "変更後の文字";
    const result = await inspectDirectText(
      await exportPdf(edited, fontBytes),
      0,
    );
    expect(result.runs.map((r) => r.text)).toEqual(["変更後の文字"]);
  });
  it("rejects stale hashes, changed text/index and duplicate operation references", async () => {
    const d = await edit(await fixture()),
      obj = d.pages[0].objects[0],
      ref = obj.sourceText!;
    for (const patch of [
      { contentHash: "0".repeat(64) },
      { originalText: "mismatch" },
      { sourceIndex: 1 },
      { sourceId: "other" },
    ]) {
      const invalid = structuredClone(d);
      invalid.pages[0].objects[0].sourceText = { ...ref, ...patch };
      await expect(exportPdf(invalid)).rejects.toThrow();
    }
    const duplicated = structuredClone(d);
    duplicated.pages[0].objects.push({ ...obj, id: "duplicate" });
    await expect(exportPdf(duplicated)).rejects.toThrow();
    const missing = structuredClone(d);
    delete missing.pages[0].objects[0].sourceText;
    await expect(exportPdf(missing)).rejects.toThrow();
    await expect(saveProject(missing)).rejects.toThrow();
  });
  it("does not remove the same source text from an unedited duplicate page", async () => {
    const original = await fixture(),
      d = duplicatePage(original.pages[0].id).apply(original);
    const edited = await edit(d),
      bytes = await exportPdf(edited);
    expect((await inspectDirectText(bytes, 0)).runs.map((r) => r.text)).toEqual(
      [" Following", "Replaced"],
    );
    expect((await inspectDirectText(bytes, 1)).runs.map((r) => r.text)).toEqual(
      ["UNIQUE_original_text", " Following"],
    );
    const only = await exportPdf(edited, undefined, { indices: [0] });
    expect((await allStreams(only)).join("\n")).not.toContain(
      "UNIQUE_original_text",
    );
  });
  it("refuses clipped, rotated, invisible, ActualText and unknown operator text", async () => {
    for (const commands of [
      "0 0 40 40 re W n " + content,
      content.replace("1 0 0 1 40 300 Tm", "0 1 -1 0 40 300 Tm"),
      content.replace("20 Tf", "20 Tf 3 Tr"),
      "/Span << /ActualText (UNIQUE_original_text) >> BDC " + content + " EMC",
      content + " 123 UnknownOp",
      "BI /W 1 /H 1 ID x EI " + content,
    ]) {
      const result = await inspect(await fixture(commands));
      expect(result.runs).toEqual([]);
      expect(result.unsupported).toBeTruthy();
    }
    const inner = await PDFDocument.create();
    inner.addPage().drawText("In a Form XObject");
    const outer = await PDFDocument.create(),
      p = outer.addPage();
    p.drawPage(await outer.embedPage(inner.getPage(0)));
    const result = await inspectDirectText(await outer.save(), 0);
    expect(result.runs).toEqual([]);
    expect(result.unsupported).toContain("Form XObject");
  });
});
describe("direct edit commands and project persistence", () => {
  it("matches a PDF.js merged span to contiguous original text operators", async () => {
    const d = await fixture(),
      inspection = await inspect(d),
      run = inspection.runs[0];
    const o = directTextObject(
      inspection,
      d.pages[0],
      "UNIQUE_original_text Following",
      {
        ...run,
        width: run.width + inspection.runs[1].width,
      },
    );
    expect(o.sourceText.additional).toHaveLength(1);
    const edited = addObject(d.pages[0].id, {
      ...o,
      text: "Merged replacement",
    }).apply(d);
    const reopened = await openProject(await saveProject(edited));
    expect(directReferences(reopened.pages[0])).toHaveLength(2);
    expect(
      (await inspectDirectText(await exportPdf(reopened), 0)).runs.map(
        (r) => r.text,
      ),
    ).toEqual(["Merged replacement"]);
  });
  it("supports edit/delete/revert undo, and copy as independent added text", async () => {
    const d = await edit(await fixture()),
      p = d.pages[0],
      o = p.objects[0],
      h = new History(d);
    h.execute(updateObject(p.id, o.id, { text: "Different" }));
    h.execute(deleteObject(p.id, o.id));
    expect(h.current.document.pages[0].objects[0].text).toBe("");
    expect(
      (
        await inspectDirectText(await exportPdf(h.current.document), 0)
      ).runs.map((r) => r.text),
    ).toEqual([" Following"]);
    h.undo();
    expect(h.current.document.pages[0].objects[0].text).toBe("Different");
    h.redo();
    expect(d.pages[0].objects[0].text).toBe("Replaced");
    h.execute(revertDirectText(p.id, o.id));
    expect(directReferences(h.current.document.pages[0])).toEqual([]);
    expect(
      (await inspectDirectText(await exportPdf(h.current.document), 0)).runs[0]
        .text,
    ).toBe("UNIQUE_original_text");
    h.undo();
    expect(directReferences(h.current.document.pages[0])).toHaveLength(1);
    const pasted = pasteObject(p.id, { object: o }).command.apply(d);
    expect(pasted.pages[0].objects[1].kind).toBe("text");
    expect(pasted.pages[0].objects[1].sourceText).toBeUndefined();
    await expect(exportPdf(pasted)).resolves.toBeInstanceOf(Uint8Array);
  });
  it("persists the exact source reference and checks reopened PDF output", async () => {
    const d = await edit(await fixture()),
      reopened = await openProject(await saveProject(d));
    expect(reopened.pages[0].objects[0].sourceText).toEqual(
      d.pages[0].objects[0].sourceText,
    );
    expect(
      (await inspectDirectText(await exportPdf(reopened), 0)).runs.map(
        (r) => r.text,
      ),
    ).toEqual([" Following", "Replaced"]);
  });
  it("rejects ambiguous selection and an already edited text run", async () => {
    const d = await fixture(),
      inspection = await inspect(d),
      r = inspection.runs[0];
    expect(() =>
      directTextObject({ runs: [r, r] }, d.pages[0], r.text, r),
    ).toThrow();
    const edited = await edit(d);
    expect(() =>
      directTextObject(inspection, edited.pages[0], r.text, r),
    ).toThrow();
    expect(() =>
      directTextObject(inspection, d.pages[0], "wrong", r),
    ).toThrow();
  });
});
