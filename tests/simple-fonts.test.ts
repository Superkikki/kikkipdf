import { describe, expect, it } from "vitest";
import { fontEncoding, glyphUnicode, standardWidths } from "../src/direct/simpleFonts";

describe("Adobe glyph naming and original standard metrics", () => {
  it("resolves named, suffixed, composite and Unicode glyphs", () => {
    expect(glyphUnicode("Aacute.alt")).toBe("Á");
    expect(glyphUnicode("f_f_i")).toBe("ffi");
    expect(glyphUnicode("uni65E5672C")).toBe("日本");
    expect(glyphUnicode("u1F600")).toBe("😀");
  });
  it("rejects invalid scalars and unknown glyph names", () => {
    for (const name of ["", "uniD800", "u110000", "uni123", "UnknownGlyph", "A_UnknownGlyph", "__proto__", "constructor"])
      expect(glyphUnicode(name)).toBeUndefined();
  });
  it("uses Symbol, Dingbats and MacExpert glyph definitions with original widths", () => {
    expect(glyphUnicode(fontEncoding("SymbolSetEncoding")![65])).toBe("Α");
    expect(glyphUnicode(fontEncoding("ZapfDingbatsEncoding")![33])).toBe("✁");
    expect(standardWidths("Symbol")!.Alpha).toBe(722);
    expect(standardWidths("ZapfDingbats")!.a1).toBe(974);
    expect(fontEncoding("MacExpertEncoding")).toHaveLength(256);
  });
});
