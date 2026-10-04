import { expect, it } from "vitest";
import type { CommentRow } from "../src/annotations/comments";
import { commentsCsv } from "../src/annotations/commentCsv";

const row = (overrides: Partial<CommentRow> = {}): CommentRow => ({
  id: "1R", key: "p1:1R", pageId: "p1", pageIndex: 0,
  text: "内容", author: "佐藤", reviewStatus: "Accepted", reviewable: true,
  added: false, editable: true, ...overrides,
});
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

it("writes BOM, Japanese headers and fully quoted CRLF CSV with quote escaping", () => {
  const bytes = commentsCsv([row({ text: '改行\nと "引用"', author: "山田, 花子" })]);
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(decode(bytes)).toBe('\uFEFF"ページ","作成者","レビュー状態","コメント","区分"\r\n"1","山田, 花子","承認","改行\nと ""引用""","既存"\r\n');
});

it("protects formula-like values while preserving other whitespace and raw line-control prefixes", () => {
  const rows = [" =SUM(A1)", "+1", "-1", "@x", "\tformula", "\rformula", "\nformula", "  plain", "plain\nmultiline"]
    .map((text) => row({ text }));
  const csv = decode(commentsCsv(rows));
  for (const value of ["' =SUM(A1)", "'+1", "'-1", "'@x", "'\tformula", "'\rformula", "'\nformula", "  plain", "plain\nmultiline"]) {
    expect(csv).toContain(`"${value.replaceAll('"', '""')}"`);
  }
});

it("uses one-based numeric page values, status labels, and non-reviewable status", () => {
  const csv = decode(commentsCsv([
    row({ pageIndex: 2, reviewStatus: "Rejected" }),
    row({ pageIndex: 0, reviewStatus: "None", reviewable: false, added: true }),
  ]));
  expect(csv).toContain('"3","佐藤","却下","内容","既存"');
  expect(csv).toContain('"1","佐藤","対象外","内容","追加"');
});

it("emits only the quoted header for no rows and does not mutate input", () => {
  const empty: CommentRow[] = [];
  expect(decode(commentsCsv(empty))).toBe('\uFEFF"ページ","作成者","レビュー状態","コメント","区分"\r\n');
  const source = [row({ text: "=SUM(A1)" })];
  const before = structuredClone(source);
  commentsCsv(source);
  expect(source).toEqual(before);
});
