import { describe, expect, it } from "vitest";
import { defaultSearchOptions, findTextMatches } from "../src/viewer/search";

const parts = (text: string) => [{ key: "source:0", text }];
describe("document search", () => {
  it("finds literal, non-overlapping matches and retains source casing", () => {
    const matches = findTextMatches(parts("Cat cat scatter [cat]"), "cat");
    expect(matches.map((m) => m.match)).toEqual(["Cat", "cat", "cat", "cat"]);
    expect(findTextMatches(parts("[cat] .* [cat]"), "[cat]")).toHaveLength(2);
    expect(findTextMatches(parts("aaa"), "aa")).toHaveLength(1);
    expect(findTextMatches(parts("Cat cat"), "cat", { ...defaultSearchOptions, caseSensitive: true })
      .map((m) => m.start)).toEqual([4]);
  });
  it("joins split PDF words and maps a phrase across lines to exact text-layer ranges", () => {
    const matches = findTextMatches([
      { key: "source:0", text: "Search ab" },
      { key: "source:1", text: "c", hasEOL: true },
      { key: "source:2", text: "" },
      { key: "source:3", text: "next line" },
    ], "abc next");
    expect(matches[0].match).toBe("abc\nnext");
    expect(matches[0].fragments).toEqual([
      { key: "source:0", start: 7, end: 9 },
      { key: "source:1", start: 0, end: 1 },
      { key: "source:3", start: 0, end: 4 },
    ]);
  });
  it("normalizes widths, ligatures and combining marks without losing UTF-16 offsets", () => {
    const text = "😀ＡＢＣ ｶﾞ e\u0301 ﬃ İ";
    for (const [query, expected] of [["abc", "ＡＢＣ"], ["ガ", "ｶﾞ"], ["é", "e\u0301"], ["ffi", "ﬃ"], ["i\u0307", "İ"]]) {
      const hit = findTextMatches(parts(text), query)[0];
      expect(hit.match).toBe(expected);
      expect(text.slice(hit.fragments[0].start, hit.fragments[0].end)).toBe(expected);
    }
    expect(findTextMatches(parts(text), "abc", { ...defaultSearchOptions, normalizeWidth: false })).toEqual([]);
    expect(findTextMatches(parts("ﬃ"), "f")).toHaveLength(1);
  });
  it("matches Unicode word boundaries, including astral letters, numbers and combining marks", () => {
    const options = { ...defaultSearchOptions, wholeWord: true };
    expect(findTextMatches(parts("cat scatter cat2 _cat cat_ (cat)"), "cat", options)
      .map((m) => m.start)).toEqual([0, 28]);
    expect(findTextMatches(parts("é café é"), "é", options)).toHaveLength(2);
    expect(findTextMatches(parts("𐐀cat cat😀"), "cat", options)).toHaveLength(1);
    expect(findTextMatches(parts("資料 資料集"), "資料", options)).toHaveLength(1);
  });
  it("collapses whitespace, bounds result counts and ignores empty queries", () => {
    expect(findTextMatches(parts("one \n\t two"), "one two")[0].match).toBe("one \n\t two");
    expect(findTextMatches(parts("token ".repeat(200)), "token", defaultSearchOptions, 101)).toHaveLength(101);
    expect(findTextMatches(parts("text"), " \t ")).toEqual([]);
    expect(findTextMatches(parts("text"), "text", defaultSearchOptions, 0)).toEqual([]);
  });
});
