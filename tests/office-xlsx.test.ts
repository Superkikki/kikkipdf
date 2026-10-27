import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { createTextXlsx } from "../src/office/xlsx";

describe("Excel text export", () => {
  it("preserves page names, Unicode, blank rows and treats formulas as text", () => {
    const files = unzipSync(createTextXlsx(["日本語 & <test>\n=1+1\n\nlast", "other"], [3, 1]));
    const workbook = strFromU8(files["xl/workbook.xml"]);
    expect(workbook).toContain('name="ページ3"');
    expect(workbook).toContain('name="ページ1"');
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("日本語 &amp; &lt;test&gt;");
    expect(sheet).toContain('r="A2" t="inlineStr"');
    expect(sheet).toContain("=1+1");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('r="A4"');
  });
  it("rejects invalid or excessive input instead of truncating", () => {
    expect(() => createTextXlsx([])).toThrow();
    expect(() => createTextXlsx(["a", "b"], [1, 1])).toThrow();
    expect(() => createTextXlsx(["x".repeat(32768)])).toThrow();
    expect(() => createTextXlsx(Array(201).fill(""))).toThrow();
  });
});
