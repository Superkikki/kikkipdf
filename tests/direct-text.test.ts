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
    await outer.flush();
    for (const [, object] of outer.context.enumerateIndirectObjects())
      if (object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Form"))
        object.dict.set(PDFName.of("Group"), outer.context.obj({ S: "Transparency" }));
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

describe("verified simple font encodings", () => {
  async function encodedFixture(options: {
    encoding: string | { BaseEncoding?: string; Differences?: unknown[] };
    type?: "TrueType";
    unicode?: string;
    widths?: number[];
    first?: number;
    commands?: string;
  }) {
    const d = await fixture(options.commands ?? "BT /F1 20 Tf 1 0 0 1 40 300 Tm <80> Tj <81> Tj ET");
    const pdf = await PDFDocument.load(d.sources.s.bytes);
    const font = pdf.getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict).lookup(PDFName.of("F1"), PDFDict);
    font.set(PDFName.of("Encoding"), pdf.context.obj(options.encoding));
    if (options.type) font.set(PDFName.of("Subtype"), PDFName.of(options.type));
    if (options.unicode) font.set(PDFName.of("ToUnicode"), pdf.context.register(pdf.context.flateStream(options.unicode)));
    if (options.widths) {
      font.set(PDFName.of("FirstChar"), pdf.context.obj(options.first ?? 128));
      font.set(PDFName.of("LastChar"), pdf.context.obj((options.first ?? 128) + options.widths.length - 1));
      font.set(PDFName.of("Widths"), pdf.context.obj(options.widths));
    }
    return fromBytes(await pdf.save());
  }

  it("uses StandardEncoding quote glyphs and rejects an unspecified embedded encoding without Unicode", async () => {
    const d = await encodedFixture({ encoding: "StandardEncoding", commands: "BT /F1 20 Tf 1 0 0 1 40 300 Tm <27> Tj <60> Tj ET" });
    const result = await inspect(d);
    expect(result.runs.map(r => r.text)).toEqual(["’", "‘"]);
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    expect(result.runs[1].x).toBeCloseTo(40 + font.widthOfTextAtSize("’", 20));
    const unknown = await encodedFixture({ encoding: {}, type: "TrueType", widths: [600, 600] });
    expect((await inspect(unknown)).runs).toEqual([]);
  });

  it("decodes MacRoman and keeps the next glyph at the original position after removal", async () => {
    const d = await encodedFixture({ encoding: "MacRomanEncoding" });
    const result = await inspect(d);
    expect(result.runs.map(r => r.text)).toEqual(["Ä", "Å"]);
    const modified = await edit(d, "Ä");
    const output = await inspectDirectText(await exportPdf(modified), 0);
    const neighbour = output.runs.find(r => r.text === "Å")!;
    expect(neighbour.x).toBeCloseTo(result.runs[1].x, 7);
    expect(output.runs.some(r => r.text === "Ä")).toBe(false);
    expect(output.runs.some(r => r.text === "Replaced")).toBe(true);
  });

  it("accepts Differences with authoritative Unicode and widths, including non-Latin glyph names", async () => {
    const d = await encodedFixture({
      encoding: { BaseEncoding: "WinAnsiEncoding", Differences: [128, "uni65E5", "uni672C"] },
      unicode: "2 beginbfchar <80> <65E5> <81> <672C> endbfchar",
      widths: [1000, 750],
    });
    const result = await inspect(d);
    expect(result.runs.map(r => r.text)).toEqual(["日", "本"]);
    expect(result.runs[1].x).toBe(60);
    const output = await inspectDirectText(await exportPdf(await edit(d, "日")), 0);
    expect(output.runs.find(r => r.text === "本")!.x).toBe(60);
    expect(output.runs.some(r => r.text === "日")).toBe(false);
  });

  it("accepts an explicit Unicode mapping for non-ASCII StandardEncoding only with original widths", async () => {
    const params = { encoding: "StandardEncoding", unicode: "2 beginbfchar <80> <00660069> <81> <0066006C> endbfchar" };
    expect((await inspect(await encodedFixture(params))).runs).toEqual([]);
    const d = await encodedFixture({ ...params, widths: [500, 600] });
    const result = await inspect(d);
    expect(result.runs.map(r => r.text)).toEqual(["fi", "fl"]);
    expect(result.runs[1].x).toBe(50);
  });

  it("rejects unknown or ambiguous Differences instead of assuming WinAnsi", async () => {
    for (const params of [
      { encoding: { Differences: [128, "A", "B"] }, widths: [600, 600] },
      { encoding: { Differences: [128, "A", "B"] }, unicode: "2 beginbfchar <80> <0041> <81> <0042> endbfchar" },
      { encoding: { Differences: ["A"] }, unicode: "2 beginbfchar <80> <0041> <81> <0042> endbfchar", widths: [600, 600] },
      { encoding: { Differences: [256, "A"] }, unicode: "2 beginbfchar <80> <0041> <81> <0042> endbfchar", widths: [600, 600] },
      { encoding: { Differences: [128, "A", 128, "B"] }, unicode: "2 beginbfchar <80> <0041> <81> <0042> endbfchar", widths: [600, 600] },
    ]) expect((await inspect(await encodedFixture(params))).runs).toEqual([]);
  });

  it("rejects an unmapped custom code and width entries outside the declared range", async () => {
    for (const params of [
      { encoding: { Differences: [128, "A", "B"] }, unicode: "1 beginbfchar <80> <0041> endbfchar", widths: [600, 600] },
      { encoding: { Differences: [128, "A", "B"] }, unicode: "2 beginbfchar <80> <0041> <81> <0042> endbfchar", widths: [600] },
    ]) {
      const result = await inspect(await encodedFixture(params));
      expect(result.runs.map(r => r.text)).toEqual(["A"]);
      expect(result.unsupported).toBeTruthy();
    }
  });
});

it("decodes supplementary and multi-character Unicode ranges without wrapping or accepting broken surrogates", () => {
  const emoji = unicodeMap(enc("1 beginbfrange <0001> <0003> <D83DDE00> endbfrange"));
  expect([...emoji.values()]).toEqual(["😀", "😁", "😂"]);
  const strings = unicodeMap(enc("1 beginbfrange <01> <03> <00660069> endbfrange"));
  expect([...strings.values()]).toEqual(["fi", "fj", "fk"]);
  for (const input of [
    "1 beginbfrange <0001> <0002> <D83DDFFF> endbfrange",
    "1 beginbfrange <0001> <0002> <FFFF> endbfrange",
    "1 beginbfrange <0001> <0002> <0066FFFF> endbfrange",
    "1 beginbfrange <0001> <0002> <D83D> endbfrange",
    "1 beginbfrange <0001> <0002> <00> endbfrange",
  ]) expect(() => unicodeMap(enc(input))).toThrow();
  const largeGlyph = "0041".repeat(100);
  expect(() => unicodeMap(enc(`1 beginbfrange <0000> <FE00> <${largeGlyph}> endbfrange`))).toThrow("大きすぎます");
});

async function formFixture(options: { nested?: boolean; repeated?: boolean; commands?: string;
  inheritedResources?: boolean; matrix?: number[] } = {}) {
  const pdf = await PDFDocument.create(), p = pdf.addPage([420, 400]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  await pdf.flush();
  const fonts = pdf.context.obj({ Font: { F1: font.ref } });
  const leaf = pdf.context.flateStream(enc(options.commands ??
    "BT /F1 12 Tf 1 0 0 1 20 50 Tm (FORM_original) Tj ( Tail) Tj ET"), {
    Type: "XObject", Subtype: "Form", BBox: [0, 0, 400, 150],
    Matrix: options.matrix ?? [1, 0, 0, 1, 0, 0],
  });
  if (!options.inheritedResources) leaf.dict.set(PDFName.of("Resources"), fonts);
  let form = pdf.context.register(leaf);
  if (options.nested) form = pdf.context.register(pdf.context.flateStream(
    enc("q 1 0 0 1 5 6 cm /Leaf Do Q"), {
      Type: "XObject", Subtype: "Form", BBox: [0, 0, 410, 160],
      Resources: { Font: { F1: font.ref }, XObject: { Leaf: form } },
    }));
  p.node.set(PDFName.of("Resources"), pdf.context.obj({ Font: { F1: font.ref }, XObject: { Form: form } }));
  p.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(enc(
    "q 1 0 0 1 0 180 cm /Form Do Q" + (options.repeated ? " q 1 0 0 1 0 10 cm /Form Do Q" : "")))));
  return fromBytes(await pdf.save());
}
describe("Form XObject text editing", () => {
  it("edits only one invocation of a shared nested Form and retains neighbours and other pages", async () => {
    // Use the same source Form twice, plus an unedited copy of the source page.
    const original = await formFixture({ nested: true, repeated: true, matrix: [1.1, 0, 0, 1.1, 2, 3] });
    const model = duplicatePage(original.pages[0].id).apply(original);
    const before = await inspect(model);
    const target = before.runs.find(r => r.text === "FORM_original")!;
    expect(target.reference.formPath).toHaveLength(2);
    const object = directTextObject(before, model.pages[0], target.text, target);
    const edited = addObject(model.pages[0].id, { ...object, text: "Changed form" }).apply(model);
    const loaded = await openProject(await saveProject(edited));
    expect(loaded.pages[0].objects[0].sourceText!.formPath).toEqual(target.reference.formPath);
    const output = await exportPdf(loaded);
    const first = await inspectDirectText(output, 0), second = await inspectDirectText(output, 1);
    expect(first.runs.filter(r => r.text === "FORM_original")).toHaveLength(1);
    expect(first.runs.some(r => r.text === "Changed form")).toBe(true);
    expect(second.runs.filter(r => r.text === "FORM_original")).toHaveLength(2);
    const tails = before.runs.filter(r => r.text === " Tail");
    first.runs.filter(r => r.text === " Tail").forEach((r, i) => {
      expect(r.x).toBeCloseTo(tails[i].x, 7); expect(r.y).toBeCloseTo(tails[i].y, 7);
    });
    const h = new History(model); h.execute(addObject(model.pages[0].id, object)); h.undo();
    expect(directReferences(h.current.document.pages[0])).toHaveLength(0);
    h.redo(); expect(directReferences(h.current.document.pages[0])).toHaveLength(1);
  });
  it("removes original Form strings and orphan streams when all invocations are edited", async () => {
    let d = await formFixture({ nested: true, repeated: true });
    const inspection = await inspect(d);
    for (const run of inspection.runs.filter(r => r.text === "FORM_original"))
      d = addObject(d.pages[0].id, { ...directTextObject(inspection, d.pages[0], run.text, run), text: "Changed" }).apply(d);
    const output = await exportPdf(d);
    expect((await allStreams(output)).join("\n")).not.toContain("FORM_original");
    expect((await inspectDirectText(output, 0)).runs.filter(r => r.text === "Changed")).toHaveLength(2);
  });
  it("supports resource inheritance and restores the parent's graphics state after Form calls", async () => {
    const d = await formFixture({ inheritedResources: true });
    const pdf = await PDFDocument.load(d.sources.s.bytes), p = pdf.getPage(0);
    const form = p.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).lookup(PDFName.of("Form"));
    if (!(form instanceof PDFRawStream)) throw Error("Form stream missing");
    const leaf = pdf.context.flateStream(enc("0 0 1 rg " + dec(boundedDecode(form))), {
      Subtype: "Form", BBox: [0, 0, 400, 150],
    });
    const formRef = p.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).get(PDFName.of("Form"))!;
    pdf.context.assign(formRef as import("pdf-lib").PDFRef, leaf);
    p.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(enc(
      "1 0 0 rg q 1 0 0 1 0 180 cm /Form Do Q BT /F1 12 Tf 1 0 0 1 40 360 Tm (Parent text) Tj ET"))));
    d.sources.s.bytes = await pdf.save();
    const inspection = await inspect(d);
    expect(inspection.runs.map(r => r.text)).toEqual(["FORM_original", " Tail", "Parent text"]);
    expect(inspection.runs.map(r => r.color)).toEqual(["#0000ff", "#0000ff", "#ff0000"]);
    expect(inspection.runs[2].x).toBe(40);
    expect(inspection.runs[2].baseline).toBe(40);
    const output = await exportPdf(await edit(d, "FORM_original"));
    expect((await inspectDirectText(output, 0)).runs.map(r => r.text)).toEqual([" Tail", "Parent text", "Replaced"]);
  });
  it("rejects stale invocation paths and changed Form matrices or bytes", async () => {
    const d = await edit(await formFixture({ nested: true }), "FORM_original");
    for (const patch of [{ formPath: [999] }, { formPath: undefined }, { contentHash: "0".repeat(64) }]) {
      const invalid = structuredClone(d); Object.assign(invalid.pages[0].objects[0].sourceText!, patch);
      await expect(exportPdf(invalid)).rejects.toThrow();
    }
    for (const geometry of [true, false]) {
      const changed = structuredClone(d), pdf = await PDFDocument.load(changed.sources.s.bytes);
      const form = pdf.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).lookup(PDFName.of("Form"));
    if (!(form instanceof PDFRawStream)) throw Error("Form stream missing");
      if (geometry) form.dict.set(PDFName.of("Matrix"), pdf.context.obj([1, 0, 0, 1, 20, 0]));
      else form.contents[0] = 32;
      changed.sources.s.bytes = await pdf.save();
      await expect(exportPdf(changed)).rejects.toThrow();
    }
  });
  it("bounds Form nesting and refuses unsupported external/group types", async () => {
    const d = await formFixture(), pdf = await PDFDocument.load(d.sources.s.bytes), p = pdf.getPage(0);
    const xobjects = p.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
    let ref = xobjects.get(PDFName.of("Form"))!;
    const leaf = pdf.context.lookup(ref);
    if (!(leaf instanceof PDFRawStream)) throw Error("Form stream missing");
    for (const [name, value] of [
      ["Group", pdf.context.obj({ S: "Transparency" })], ["Ref", pdf.context.obj({})],
      ["FormType", pdf.context.obj(2)], ["F", PDFName.of("external")],
    ] as const) {
      leaf.dict.set(PDFName.of(name), value);
      expect((await inspectDirectText(await pdf.save(), 0)).runs).toHaveLength(0);
      leaf.dict.delete(PDFName.of(name));
    }
    for (let i = 0; i < 17; i++) ref = pdf.context.register(pdf.context.flateStream(enc("/Child Do"), {
      Subtype: "Form", BBox: [0, 0, 420, 400], Resources: { XObject: { Child: ref } },
    }));
    xobjects.set(PDFName.of("Form"), ref);
    expect((await inspectDirectText(await pdf.save(), 0)).unsupported).toContain("複雑すぎます");
  });
  it("refuses clipped, inherited ActualText, rotated and cyclic Forms", async () => {
    for (const options of [
      { commands: "0 0 1 1 re W n BT /F1 12 Tf 1 0 0 1 20 50 Tm (FORM_original) Tj ET" },
      { commands: "BT /F1 12 Tf 1 0 0 1 20 0 Tm (FORM_original) Tj ET" },
      { matrix: [0, 1, -1, 0, 150, 0] },
    ]) expect((await inspect(await formFixture(options))).runs).toHaveLength(0);
    const d = await formFixture(), pdf = await PDFDocument.load(d.sources.s.bytes), p = pdf.getPage(0);
    p.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(
      enc("/Span << /ActualText (hidden) >> BDC /Form Do EMC"))));
    expect((await inspectDirectText(await pdf.save(), 0)).runs).toHaveLength(0);
    const form = p.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).get(PDFName.of("Form"))!;
    const cyclic = pdf.context.flateStream(enc("/Loop Do"), {
      Subtype: "Form", BBox: [0, 0, 420, 400], Resources: { XObject: { Loop: form } },
    });
    pdf.context.assign(form as import("pdf-lib").PDFRef, cyclic);
    p.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(enc("/Form Do"))));
    expect((await inspectDirectText(await pdf.save(), 0)).unsupported).toContain("循環");
  });
});
