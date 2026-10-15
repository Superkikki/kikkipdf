import { describe, expect, it } from "vitest";
import { compareText, extractedText, MAX_PAGE_TEXT } from "../src/compare/text";

const restore = (result: ReturnType<typeof compareText>, side: "left" | "right") => result.changes
  .filter(part => part.kind !== (side === "left" ? "added" : "removed")).map(part => part.text).join("");

describe("PDF text comparison", () => {
  it("preserves unchanged text and handles empty and one-sided text", () => {
    expect(compareText("同じ\n文字", "同じ\n文字")).toEqual({ changed: false, added: 0, removed: 0, simplified: false, changes: [{ kind: "same", text: "同じ\n文字" }] });
    expect(compareText("", "").changes).toEqual([]);
    expect(compareText("", "追加")).toMatchObject({ changed: true, added: 2, removed: 0 });
    expect(compareText("削除", "")).toMatchObject({ changed: true, added: 0, removed: 2 });
  });

  it("isolates multiple edits and retains common content between them", () => {
    const result = compareText("価格100円、税込です。", "価格200円、税別です。");
    expect(result.added).toBe(2); expect(result.removed).toBe(2);
    expect(result.changes).toContainEqual({ kind: "same", text: "00円、税" });
    expect(restore(result, "left")).toBe("価格100円、税込です。");
    expect(restore(result, "right")).toBe("価格200円、税別です。");
  });

  it("keeps whitespace, punctuation, emoji and literal markup without normalization", () => {
    const result = compareText("猫🐈 <script>\na b", "猫🐕 <script>\na  b");
    expect(result.added).toBe(2); expect(result.removed).toBe(1);
    expect(result.changes).toContainEqual({ kind: "removed", text: "🐈" });
    expect(result.changes).toContainEqual({ kind: "added", text: "🐕" });
    expect(compareText("Ａ", "A").changed).toBe(true);
    expect(compareText("é", "e\u0301").changed).toBe(true);
  });

  it("bounds large replacements and retains exact before and after content", () => {
    const left = `先頭${"a".repeat(1001)}末尾`, right = `先頭${"b".repeat(1001)}末尾`;
    const result = compareText(left, right);
    expect(result).toMatchObject({ simplified: true, changed: true, added: 1001, removed: 1001 });
    expect(restore(result, "left")).toBe(left); expect(restore(result, "right")).toBe(right);
    expect(compareText("x".repeat(MAX_PAGE_TEXT), "x".repeat(MAX_PAGE_TEXT)).changed).toBe(false);
    expect(() => compareText("x".repeat(MAX_PAGE_TEXT + 1), "")).toThrow("20,000");
  });

  it("extracts only text items, keeps line endings and bounds extraction", () => {
    expect(extractedText([{ str: "甲" }, { type: "beginMarkedContent" }, { str: " ", hasEOL: false }, { str: "乙", hasEOL: true }, { str: "丙", hasEOL: true }])).toBe("甲 乙\n丙");
    expect(extractedText([{ str: "x".repeat(MAX_PAGE_TEXT), hasEOL: true }])).toHaveLength(MAX_PAGE_TEXT);
    expect(() => extractedText([{ str: "x".repeat(MAX_PAGE_TEXT + 1) }])).toThrow("20,000");
  });

  it("reconstructs both sides and computes minimal edit counts for varied short strings", () => {
    let seed = 123;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    const alphabet = ["a", "b", "猫", "🐈", "\n"];
    const sample = () => Array.from({ length: random() % 20 }, () => alphabet[random() % alphabet.length]).join("");
    for (let n = 0; n < 100; n++) {
      const left = sample(), right = sample(), result = compareText(left, right);
      expect(restore(result, "left")).toBe(left); expect(restore(result, "right")).toBe(right);
      const a = Array.from(left), b = Array.from(right);
      const distances = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i + j));
      for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
        distances[i][j] = a[i - 1] === b[j - 1] ? distances[i - 1][j - 1] : Math.min(distances[i - 1][j], distances[i][j - 1]) + 1;
      expect(result.added + result.removed).toBe(distances[a.length][b.length]);
    }
  });
});
