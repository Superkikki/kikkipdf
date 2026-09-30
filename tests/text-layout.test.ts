import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { layoutText } from "../src/text/layout";
import { embedTextFont } from "../src/text/fonts";
import { blankPage, emptyDocument, newObject } from "../src/state/model";
import { saveProject, openProject } from "../src/state/project";
import { exportPdf } from "../src/export/engine";
import { History } from "../src/commands/history";
import { updateObject } from "../src/commands/document";

const make = (text: string, width: number) => ({
  ...newObject("text", 30, 40),
  fontSize: 10,
  text,
  width,
});
const measure = (s: string) =>
  Array.from(new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(s))
    .length * 10;

describe("lossless text box layout", () => {
  it("wraps English words and overlong tokens without losing characters", () => {
    const o = make("one two three LONGTOKEN", 70);
    const { lines } = layoutText(o, measure);
    expect(lines.map((l) => l.text)).toEqual([
      "one ",
      "two ",
      "three ",
      "LONGTOK",
      "EN",
    ]);
    expect(lines.every((l) => l.width <= o.width)).toBe(true);
    expect(lines.map((l) => l.text).join("")).toBe(o.text);
  });
  it("preserves graphemes, paragraph breaks and whitespace, and handles narrow boxes", () => {
    const text = "e\u0301👩‍💻A\r\n\r\nB\tC\n";
    const { lines } = layoutText(make(text, 10), measure);
    expect(lines.map((l) => l.text)).toEqual([
      "e\u0301",
      "👩‍💻",
      "A",
      "",
      "B",
      " ",
      " ",
      " ",
      " ",
      "C",
      "",
    ]);
    const narrow = layoutText(make("日本語", 1), measure);
    expect(narrow.lines.map((l) => l.text)).toEqual(["日", "本", "語"]);
    expect(narrow.width).toBe(10);
  });
  it("avoids Japanese opening marks at the end and closing marks at the start", () => {
    const { lines } = layoutText(
      make("これは「日本語」です。続きます。", 50),
      measure,
    );
    expect(lines.map((l) => l.text).join("")).toBe(
      "これは「日本語」です。続きます。",
    );
    expect(lines.every((l) => !/[「（]$/.test(l.text))).toBe(true);
    expect(lines.every((l) => !/^[」。、）]/.test(l.text))).toBe(true);
  });
  it("keeps old objects unwrapped and uses explicit line spacing", () => {
    const o = {
      ...make("first\nsecond\n", 10),
      wrap: undefined,
      lineHeight: 1.6,
    };
    const layout = layoutText(o, measure);
    expect(layout.lines.map((l) => l.text)).toEqual(["first", "second", ""]);
    expect(layout.lines.map((l) => l.baseline)).toEqual([10, 26, 42]);
    expect(layout.height).toBe(44.5);
  });
  it("round-trips settings in projects and supports independent undo/redo", async () => {
    const model = emptyDocument();
    model.pages = [blankPage()];
    const o = make("wrapped paragraph", 60);
    model.pages[0].objects = [o];
    const history = new History(model);
    history.execute(
      updateObject(model.pages[0].id, o.id, { wrap: false, lineHeight: 2 }),
    );
    history.undo();
    expect(history.current.document.pages[0].objects[0]).toEqual(o);
    history.redo();
    const restored = await openProject(
      await saveProject(history.current.document),
    );
    expect(restored.pages[0].objects[0]).toMatchObject({
      wrap: false,
      lineHeight: 2,
    });
  });
  it("exports every line with the same font metrics, alignment and line spacing", async () => {
    const model = emptyDocument();
    model.pages = [blankPage()];
    const o = {
      ...make("one two three four five", 50),
      font: "sans" as const,
      align: "right" as const,
      height: 1,
      lineHeight: 1.6,
    };
    model.pages[0].objects = [o];
    const metricsDoc = await PDFDocument.create();
    const font = await metricsDoc.embedFont(StandardFonts.Helvetica);
    const layout = layoutText(o, (text) =>
      font.widthOfTextAtSize(text, o.fontSize),
    );
    expect(layout.lines.length).toBeGreaterThan(1);
    const pdf = await PDFDocument.load(await exportPdf(model));
    const streams = pdf.getPage(0).node.Contents() as PDFArray;
    const data = Array.from({ length: streams.size() }, (_, i) =>
      new TextDecoder().decode(
        decodePDFRawStream(streams.lookup(i, PDFRawStream)).decode(),
      ),
    ).join("\n");
    for (const line of layout.lines) {
      expect(data).toContain(`${font.encodeText(line.text)} Tj`);
      const x = o.x + o.width - line.width;
      const y = model.pages[0].height - o.y - line.baseline;
      expect(data).toContain(`1 0 0 1 ${x} ${y} Tm`);
    }
    // Height is advisory: it must never silently drop overflowing text.
    expect((data.match(/ Tj/g) ?? []).length).toBe(layout.lines.length);
  });
  it("uses embedded Japanese metrics for mixed language lines within the box width", async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const bytes = new Uint8Array(
      await readFile("public/assets/NotoSansJP-Regular.otf"),
    );
    const o = make(
      "日本語の文章を折り返します。 English words are included.",
      65,
    );
    const font = await embedTextFont(doc, o, bytes);
    const layout = layoutText(o, (text) =>
      font.widthOfTextAtSize(text, o.fontSize),
    );
    expect(layout.lines.length).toBeGreaterThan(3);
    expect(layout.lines.map((l) => l.text).join("")).toBe(o.text);
    expect(layout.lines.every((l) => l.width <= o.width + 0.001)).toBe(true);
  });
});
