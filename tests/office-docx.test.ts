import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { createTextDocx } from "../src/office/docx";

describe("editable Word text export", () => {
  it("packages Unicode text, XML-sensitive characters, whitespace and page breaks", () => {
    const files = unzipSync(createTextDocx([" 日本語 & <ok> 😀\nsecond", "third\u0000line"]));
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "word/document.xml"].sort());
    const xml = strFromU8(files["word/document.xml"]);
    expect(xml).toContain(" 日本語 &amp; &lt;ok&gt; 😀");
    expect(xml).toContain('xml:space="preserve"');
    expect(xml).toContain("second");
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain("third\ufffdline");
  });
  it("rejects excessive or empty input", () => {
    expect(() => createTextDocx([])).toThrow();
    expect(() => createTextDocx(Array(2001).fill(""))).toThrow();
    expect(() => createTextDocx(["x".repeat(10_000_001)])).toThrow();
  });
});
