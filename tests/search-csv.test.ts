import { expect, it } from "vitest";
import { searchCsv } from "../src/viewer/searchCsv";
import { defaultSearchOptions, type SearchHit } from "../src/viewer/search";

it("exports every retained result, including search settings and the truncation indicator", () => {
  const hits: SearchHit[] = Array.from({ length: 101 }, (_, index) => ({ id: String(index), pageId: "p", pageNumber: index + 1,
    start: 0, end: 1, before: "前,文脈", match: '日"本\n語', after: "=SUM(A1)", fragments: [] }));
  const bytes = searchCsv(hits, "@query", defaultSearchOptions, "1-101", true);
  expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
  const text = new TextDecoder().decode(bytes);
  expect(text).toContain('"101","前,文脈","日""本\n語","\'=SUM(A1)","\'@query","1-101","いいえ","いいえ","はい","はい"');
  expect(text.match(/"前,文脈"/g)).toHaveLength(101);
});
