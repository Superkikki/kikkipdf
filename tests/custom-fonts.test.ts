import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { inspectFont } from "../src/fonts/inspect";
import { checkFontBudget } from "../src/fonts/budget";
import { registerFont, removeUnusedFonts } from "../src/fonts/commands";
import { blankPage, emptyDocument, newObject } from "../src/state/model";
import { History } from "../src/commands/history";
import { mergeDocuments } from "../src/commands/document";
import { pasteObject } from "../src/editor/objectActions";
import { saveProject, openProject } from "../src/state/project";
import { exportPdf } from "../src/export/engine";
const ttf = async () =>
  new Uint8Array(
    await readFile(
      "public/assets/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
    ),
  );
function table(bytes: Uint8Array, tag: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(at, at + 4)) === tag)
      return { at, offset: view.getUint32(at + 8), view };
  }
  throw Error("missing test table");
}
describe("local custom fonts", () => {
  it("identifies static TTF and OTF by content and rejects other formats and broken tables", async () => {
    const bytes = await ttf();
    const first = await inspectFont(bytes, "font.ttf");
    expect(first).toMatchObject({ family: "Liberation Sans", format: "ttf" });
    expect((await inspectFont(bytes, "renamed.ttf")).id).toBe(first.id);
    expect(
      (
        await inspectFont(
          new Uint8Array(
            await readFile("public/assets/NotoSansJP-Regular.otf"),
          ),
          "jp.otf",
        )
      ).format,
    ).toBe("otf");
    await expect(inspectFont(new Uint8Array(20), "bad.ttf")).rejects.toThrow(
      "TTF",
    );
    const broken = bytes.slice(),
      t = table(broken, "head");
    t.view.setUint32(t.at + 8, broken.length);
    await expect(inspectFont(broken, "bad.ttf")).rejects.toThrow("範囲");
    const variable = bytes.slice(),
      v = table(variable, "name");
    variable.set(new TextEncoder().encode("fvar"), v.at);
    await expect(inspectFont(variable, "variable.ttf")).rejects.toThrow("可変");
  });
  it("honors editable embedding flags and accepts full-only embedding", async () => {
    for (const flag of [2, 4, 0x208, 1, 12]) {
      const bytes = await ttf(),
        t = table(bytes, "OS/2");
      t.view.setUint16(t.offset, 3);
      t.view.setUint16(t.offset + 8, flag);
      await expect(inspectFont(bytes, "restricted.ttf")).rejects.toThrow(
        /権限|許可/,
      );
    }
    const full = await ttf(),
      t = table(full, "OS/2");
    t.view.setUint16(t.offset, 3);
    t.view.setUint16(t.offset + 8, 0x108);
    expect((await inspectFont(full, "full.ttf")).format).toBe("ttf");
  });
  it("registers and assigns in one undo step and carries fonts through paste and merge", async () => {
    const font = await inspectFont(await ttf(), "local.ttf");
    const d = emptyDocument();
    d.pages = [blankPage()];
    const object = { ...newObject("text", 40, 50), text: "Local font" };
    d.pages[0].objects = [object];
    const h = new History(d);
    h.execute(registerFont(font, d.pages[0].id, object.id));
    const edited = h.current.document;
    expect(edited.pages[0].objects[0].fontId).toBe(font.id);
    expect(
      registerFont(
        { ...font, bytes: font.bytes.slice() },
        d.pages[0].id,
        object.id,
      ).apply(edited),
    ).toBe(edited);
    h.undo();
    expect(h.current.document).toBe(d);
    h.redo();
    expect(h.current.document).toBe(edited);
    const target = emptyDocument();
    target.pages = [blankPage()];
    const pasted = pasteObject(target.pages[0].id, {
      object: edited.pages[0].objects[0],
      font,
    }).command.apply(target);
    expect(pasted.fonts?.[font.id]).toEqual(font);
    expect(mergeDocuments(edited).apply(target).fonts?.[font.id]).toEqual(font);
    const assets = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`f${i}`, font]),
    );
    expect(() => checkFontBudget(assets)).toThrow("32件");
    const unused = { ...target, fonts: { [font.id]: font } };
    const cleanup = new History(unused);
    cleanup.execute(removeUnusedFonts());
    expect(cleanup.current.document.fonts).toEqual({});
    cleanup.undo();
    expect(cleanup.current.document.fonts?.[font.id]).toEqual(font);
    expect(removeUnusedFonts().apply(edited)).toBe(edited);
  });
  it("round-trips font bytes and detects corrupt assets and missing references", async () => {
    const font = await inspectFont(await ttf(), "local.ttf");
    const d = emptyDocument();
    d.pages = [blankPage()];
    d.fonts = { [font.id]: font };
    d.pages[0].objects = [
      {
        ...newObject("text", 40, 50),
        font: "custom",
        fontId: font.id,
        text: "Local font",
      },
    ];
    const saved = await saveProject(d),
      restored = await openProject(saved);
    expect(restored.fonts?.[font.id]).toEqual(font);
    const files = unzipSync(saved);
    files["fonts/0.ttf"][files["fonts/0.ttf"].length - 1] ^= 1;
    await expect(openProject(zipSync(files))).rejects.toThrow("整合性");
    const missing = unzipSync(saved),
      manifest = JSON.parse(strFromU8(missing["document.json"]));
    manifest.document.fonts = {};
    missing["document.json"] = strToU8(JSON.stringify(manifest));
    await expect(openProject(zipSync(missing))).rejects.toThrow("参照フォント");
  });
  it("embeds complete font bytes once across styles and refuses missing glyphs", async () => {
    const asset = await inspectFont(await ttf(), "local.ttf");
    const d = emptyDocument();
    d.pages = [blankPage()];
    d.fonts = { [asset.id]: asset };
    const object = {
      ...newObject("text", 40, 50),
      font: "custom" as const,
      fontId: asset.id,
      text: "Custom font text",
    };
    d.pages[0].objects = [
      object,
      { ...object, id: "second", y: 100, bold: true, italic: true },
    ];
    const pdf = await PDFDocument.load(await exportPdf(d));
    const embedded = pdf.context
      .enumerateIndirectObjects()
      .filter(
        ([, o]) => o instanceof PDFDict && o.has(PDFName.of("FontFile2")),
      );
    expect(embedded).toHaveLength(1);
    const descriptor = embedded[0][1] as PDFDict;
    const stream = descriptor.lookup(PDFName.of("FontFile2"));
    if (!(stream instanceof PDFRawStream))
      throw Error("Missing embedded font stream");
    expect(decodePDFRawStream(stream).decode()).toEqual(asset.bytes);
    const resources = pdf
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of("Font"), PDFDict);
    expect(new Set(resources.values().map(String)).size).toBe(1);
    expect(pdf.getPage(0).node.Contents()).toBeInstanceOf(PDFArray);
    object.text = "日本語";
    await expect(exportPdf(d)).rejects.toThrow("含まれない文字");
  });
});
