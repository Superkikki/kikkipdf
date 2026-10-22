import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName, PDFString, PDFDict } from "pdf-lib";
import names from "../src/direct/predefinedCMapNames";
import { characterCodes, mappedUnicode, parsePackedCMap, predefinedCMap } from "../src/direct/predefinedCMaps";
import { embeddedCMap } from "../src/direct/encodingCMap";
import { inspectDirectText } from "../src/direct/content";
import { directTextObject } from "../src/direct/editor";
import { blankPage, emptyDocument } from "../src/state/model";
import { exportPdf } from "../src/export/engine";
import { openProject, saveProject } from "../src/state/project";
import { unicodeMap } from "../src/direct/cmap";
const fontBytes = new Uint8Array(await readFile("public/assets/NotoSansJP-Regular.otf"));
const enc = (s: string) => new TextEncoder().encode(s);
const assetFetch = vi.fn(async (url: string) => {
  const match = /^\/assets\/pdfjs\/cmaps\/([a-zA-Z0-9-]+)\.bcmap$/.exec(url);
  if (!match || !names.includes(match[1])) throw Error("Unexpected asset URL");
  const bytes = await readFile(`node_modules/pdfjs-dist/cmaps/${match[1]}.bcmap`);
  return new Response(bytes);
});
beforeAll(() => vi.stubGlobal("fetch", assetFetch));
afterAll(() => vi.unstubAllGlobals());
async function fixture(encoding: string | Uint8Array, hex: string, ordering = "Japan1", toUnicode?: string) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([420, 400]);
  const descendant = pdf.context.register(pdf.context.obj({ Type: "Font", Subtype: "CIDFontType0", BaseFont: "HeiseiMin-W3",
    CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of(ordering), Supplement: 0 }, DW: 1000 }));
  const font = pdf.context.register(pdf.context.obj({ Type: "Font", Subtype: "Type0", BaseFont: "HeiseiMin-W3",
    Encoding: typeof encoding === "string" ? PDFName.of(encoding) : pdf.context.register(pdf.context.flateStream(encoding)),
    DescendantFonts: [descendant], ...(toUnicode ? { ToUnicode: pdf.context.register(pdf.context.flateStream(enc(toUnicode))) } : {}) }));
  page.node.set(PDFName.of("Resources"), pdf.context.obj({ Font: { F1: font } }));
  page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(enc(
    `BT /F1 20 Tf 1 0 0 1 40 300 Tm <${hex}> Tj <${hex}> Tj ET`))));
  const d = emptyDocument("cjk.pdf"); d.sources.s = { id: "s", name: "cjk.pdf", bytes: await pdf.save() };
  d.pages = [{ ...blankPage(), width: 420, height: 400, sourceId: "s", sourceIndex: 0 }];
  return d;
}
describe("bundled CJK character maps", () => {
  it("reads every bundled packed CMap and its inheritance with bounded entries", async () => {
    for (const name of names) {
      const map = await predefinedCMap(name);
      expect(map.ranges.length, name).toBeGreaterThan(0);
      expect(map.values.size, name).toBeGreaterThan(0);
    }
  });
  for (const [encoding, hex, ordering, expected] of [
    ["90ms-RKSJ-H", "93fa967b8cea", "Japan1", "日本語"],
    ["EUC-H", "c6fccbdcb8ec", "Japan1", "日本語"],
    ["UniJIS-UTF16-H", "65e5672c8a9e", "Japan1", "日本語"],
    ["GBK-EUC-H", "d6d0cec4", "GB1", "中文"],
    ["ETen-B5-H", "a4a4a4e5", "CNS1", "中文"],
    ["KSCms-UHC-H", "c7d1b1db", "Korea1", "한글"],
  ]) it(`edits ${encoding} without ToUnicode and keeps the following text position`, async () => {
    const d = await fixture(encoding, hex, ordering), before = await inspectDirectText(d.sources.s.bytes, 0);
    expect(before.runs.map(r => r.text)).toEqual([expected, expected]);
    const object = directTextObject(before, d.pages[0], expected, before.runs[0]);
    object.text = "変更した文字"; d.pages[0].objects.push(object);
    const saved = await exportPdf(await openProject(await saveProject(d)), fontBytes), after = await inspectDirectText(saved, 0);
    expect(after.runs.map(r => r.text)).toEqual([expected, object.text]);
    expect(after.runs[0].x).toBeCloseTo(before.runs[1].x, 7);
    expect(after.runs[0].y).toBeCloseTo(before.runs[1].y, 7);
  });
  it("uses CID widths rather than source code widths and honors ToUnicode first", async () => {
    const cmap = await predefinedCMap("90ms-RKSJ-H"), cid = characterCodes(cmap, new Uint8Array([0x93, 0xfa]))[0].cid;
    const d = await fixture("90ms-RKSJ-H", "93fa", "Japan1", "1 beginbfchar <93fa> <0041> endbfchar");
    const pdf = await PDFDocument.load(d.sources.s.bytes);
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      if (object instanceof PDFDict && object.lookup(PDFName.of("Subtype")) === PDFName.of("CIDFontType0"))
        object.set(PDFName.of("W"), pdf.context.obj([cid, [321], 0x93fa, [999]]));
    }
    const result = await inspectDirectText(await pdf.save(), 0);
    expect(result.runs[0].text).toBe("A"); expect(result.runs[1].x - result.runs[0].x).toBeCloseTo(6.42, 7);
  });
  it("decodes variable-length source codes, including four-byte UTF-8", async () => {
    const map = await predefinedCMap("UniJIS-UTF8-H"), collection = await predefinedCMap("Adobe-Japan1-UCS2");
    const glyphs = characterCodes(map, enc("A日本語"));
    expect(glyphs.map(g => g.length)).toEqual([1, 3, 3, 3]);
    expect(glyphs.map(g => mappedUnicode(collection.values.get(g.cid)))).toEqual(["A", "日", "本", "語"]);
  });
  it("rejects truncated codes, unmapped CIDs, unknown names and path-like names", async () => {
    const map = await predefinedCMap("90ms-RKSJ-H");
    expect(() => characterCodes(map, new Uint8Array([0x93]))).toThrow();
    const before = assetFetch.mock.calls.length;
    for (const name of ["../Identity-H", "https://example.com/CMap", "Unknown-H"])
      await expect(predefinedCMap(name)).rejects.toThrow();
    expect(assetFetch.mock.calls.length).toBe(before);
    for (const bytes of [new Uint8Array(), new Uint8Array([0, 0, 1]), new Uint8Array([0, 0, 128]), new Uint8Array([255])])
      expect(() => parsePackedCMap(bytes)).toThrow();
  });
});
describe("embedded Encoding CMaps", () => {
  it("separates source codes, CIDs, Unicode and original metrics", async () => {
    const cmap = enc("/WMode 0 def 2 begincodespacerange <00> <7f> <8100> <81ff> endcodespacerange 1 begincidchar <41> 100 endcidchar 1 begincidrange <8140> <8141> 200 endcidrange");
    const d = await fixture(cmap, "4181408141", "Identity", "3 beginbfchar <41> <0041> <8140> <65e5> <8141> <672c> endbfchar");
    const before = await inspectDirectText(d.sources.s.bytes, 0);
    expect(before.runs[0].text).toBe("A日本");
    const object = directTextObject(before, d.pages[0], "A日本", before.runs[0]);
    object.text = "Edited"; d.pages[0].objects.push(object);
    const after = await inspectDirectText(await exportPdf(d, fontBytes), 0);
    expect(after.runs.map(r => r.text)).toEqual(["A日本", "Edited"]);
    expect(after.runs[0].x).toBeCloseTo(before.runs[1].x, 7);
  });
  it("supports predefined inheritance, explicit writing mode and four-byte ToUnicode", async () => {
    const map = await embeddedCMap(enc("/90ms-RKSJ-H usecmap /WMode 1 def"));
    expect(map.vertical).toBe(true);
    expect((await embeddedCMap(enc("/90ms-RKSJ-H usecmap"), "90ms-RKSJ-H", 1)).vertical).toBe(true);
    await expect(embeddedCMap(enc("/WMode 0 def /90ms-RKSJ-H usecmap"), undefined, 1)).rejects.toThrow();
    expect(characterCodes(map, new Uint8Array([0x93, 0xfa]))[0].cid).toBeGreaterThan(0);
    const d = await fixture(enc("1 begincodespacerange <01000000> <010000ff> endcodespacerange 1 begincidchar <01000001> 200 endcidchar"),
      "01000001", "Identity", "1 beginbfchar <01000001> <65e5> endbfchar");
    expect((await inspectDirectText(d.sources.s.bytes, 0)).runs[0].text).toBe("日");
    expect(unicodeMap(enc("1 beginbfchar <01000001> <D83DDE00> endbfchar")).get(0x01000001)).toBe("😀");
  });
  it("rejects invalid, overlapping, unfinished and excessive Encoding maps", async () => {
    for (const value of [
      "1 begincidchar <41> 1", "2 begincidchar <41> 1 <41> 2 endcidchar", "1 begincidrange <0000> <ffff> 1 endcidrange",
      "1 begincodespacerange <00> <ffff> endcodespacerange", "1 begincidchar <41> -1 endcidchar", "/WMode 2 def",
      "/Unknown usecmap", "1 beginbfchar <41> <0041> endbfchar",
    ]) await expect(embeddedCMap(enc(value))).rejects.toThrow();
  });
});

it("edits Identity CID fonts without ToUnicode when their Adobe collection identifies the characters", async () => {
  const cmap = await predefinedCMap("90ms-RKSJ-H");
  const hex = characterCodes(cmap, new Uint8Array([0x93, 0xfa, 0x96, 0x7b])).map(g => g.cid.toString(16).padStart(4, "0")).join("");
  const d = await fixture("Identity-H", hex);
  expect((await inspectDirectText(d.sources.s.bytes, 0)).runs[0].text).toBe("日本");
  const unknown = await fixture("Identity-H", "00010002", "Identity");
  const unsupported = await inspectDirectText(unknown.sources.s.bytes, 0);
  expect(unsupported.runs).toHaveLength(0); expect(unsupported.unsupported).toContain("HeiseiMin-W3");
});
it("edits inherited vertical RKSJ CMaps without ToUnicode and preserves downstream origins", async () => {
  const d = await fixture("90ms-RKSJ-V", "93fa967b8cea"), before = await inspectDirectText(d.sources.s.bytes, 0), run = before.runs[0];
  expect(run.text).toBe("日本語"); expect(run.writingMode).toBe("vertical");
  const object = directTextObject(before, d.pages[0], run.text, { x: run.flowX! - 10, y: run.flowTop!, width: 20, height: 60 });
  object.text = "変更後"; d.pages[0].objects.push(object);
  const after = await inspectDirectText(await exportPdf(d, fontBytes), 0), neighbour = after.runs.find(r => r.text === "日本語")!;
  expect(neighbour.flowTop).toBeCloseTo(before.runs[1].flowTop!, 7);
  expect(neighbour.flowX).toBeCloseTo(before.runs[1].flowX!, 7);
  expect(after.runs.some(r => r.text === "変更後")).toBe(true);
});
it("supports unembedded Type1/MMType1 defaults, TrueType defaults and standard fonts with descriptors", async () => {
  for (const [type, name, flags, text, expected, standard] of [
    ["Type1", "Helvetica", 32, "4142", "AB", true],
    ["Type1", "CorporateFont", 32, "4142", "AB", false],
    ["MMType1", "CorporateFont", 32, "4142", "AB", false],
    ["TrueType", "CorporateFont", 0, "418042", "A€B", false],
    ["TrueType", "CorporateFont", 32, "4142", "AB", false],
  ] as const) {
    const pdf = await PDFDocument.create(), page = pdf.addPage([420, 400]);
    const font = pdf.context.register(pdf.context.obj({ Type: "Font", Subtype: type, BaseFont: name,
      FontDescriptor: { Type: "FontDescriptor", FontName: name, Flags: flags },
      ...(!standard ? { FirstChar: 0, LastChar: 255, Widths: Array(256).fill(500) } : {}) }));
    page.node.set(PDFName.of("Resources"), pdf.context.obj({ Font: { F1: font } }));
    page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(
      `BT /F1 20 Tf 1 0 0 1 40 300 Tm <${text}> Tj (Tail) Tj ET`)));
    const bytes = await pdf.save(), before = await inspectDirectText(bytes, 0);
    expect(before.runs[0]?.text, type).toBe(expected);
    const d = emptyDocument("simple.pdf"); d.sources.s = { id: "s", name: "simple.pdf", bytes };
    d.pages = [{ ...blankPage(), width: 420, height: 400, sourceId: "s", sourceIndex: 0 }];
    const object = directTextObject(before, d.pages[0], expected, before.runs[0]); object.text = "Changed"; object.font = "sans";
    d.pages[0].objects.push(object);
    const after = await inspectDirectText(await exportPdf(d), 0);
    expect(after.runs.some(r => r.text === "Changed")).toBe(true);
    expect(after.runs.find(r => r.text === "Tail")!.x).toBeCloseTo(before.runs[1].x, 7);
  }
});

it("applies word spacing only to a one-byte space in composite fonts", async () => {
  for (const vertical of [false, true]) {
    const encoding = vertical ? enc("/Roman usecmap /WMode 1 def") : "Roman";
    const d = await fixture(encoding, "412042"), pdf = await PDFDocument.load(d.sources.s.bytes), page = pdf.getPage(0);
    page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(
      "BT /F1 20 Tf 5 Tw 2 Tc 80 Tz 1 0 0 1 40 300 Tm <412042> Tj <412042> Tj ET")));
    d.sources.s.bytes = await pdf.save();
    const before = await inspectDirectText(d.sources.s.bytes, 0), run = before.runs[0];
    expect(run.text).toBe("A B");
    if (vertical) expect(before.runs[1].flowTop! - run.flowTop!).toBeCloseTo(49, 7);
    else expect(before.runs[1].x - run.x).toBeCloseTo(56.8, 7);
    const object = directTextObject(before, d.pages[0], "A B", vertical
      ? { x: run.flowX! - 10, y: run.flowTop!, width: 20, height: 60 } : run);
    object.text = "変更"; d.pages[0].objects.push(object);
    const after = await inspectDirectText(await exportPdf(d, fontBytes), 0), neighbour = after.runs.find(r => r.text === "A B")!;
    if (vertical) expect(neighbour.flowTop).toBeCloseTo(before.runs[1].flowTop!, 7);
    else expect(neighbour.x).toBeCloseTo(before.runs[1].x, 7);
  }
});
