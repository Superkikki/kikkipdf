import { expect, it } from "vitest";
import { blankPage, emptyDocument } from "../src/state/model";
import { parseCommentsCsv } from "../src/annotations/importCsv";
import { addImportedMarkups } from "../src/annotations/importedMarkup";
import { History } from "../src/commands/history";
import { exportPdf } from "../src/export/engine";
import { openProject, saveProject } from "../src/state/project";
import { PDFDocument, PDFDict, PDFHexString, PDFName } from "pdf-lib";
const encode = (text: string) => new TextEncoder().encode(text);
const header = '"ページ","作成者","レビュー状態","コメント","区分"\r\n';
const model = () => { const d = emptyDocument(); d.pages = [blankPage(), blankPage()]; return d; };
it("parses BOM, quotes, commas, embedded newlines and imported nonreviewable records", () => {
  const d = model(), entries = parseCommentsCsv(encode('\uFEFF' + header + '"2","佐藤,太郎","承認","改行\r\nと""引用""","追加"\r\n1,,対象外,本文,既存\r\n'), d);
  expect(entries.map(e => [e.pageId, e.markup.author, e.markup.text, e.markup.reviewStatus])).toEqual([
    [d.pages[1].id, "佐藤,太郎", '改行\r\nと"引用"', "Accepted"], [d.pages[0].id, "", "本文", "None"],
  ]);
});
it("imports notes atomically with undo, project and PDF round trips", async () => {
  const initial = model(), history = new History(initial);
  const entries = parseCommentsCsv(encode(header + '1,山田,完了,新コメント,読み込み\n2,,未確認,次ページ,追加'), initial);
  history.execute(addImportedMarkups(entries, "CSVコメントを読み込み"));
  expect(history.current.document.pages[0].importedMarkups).toHaveLength(1);
  history.undo(); expect(history.current.document).toEqual(initial); history.redo();
  const reopened = await openProject(await saveProject(history.current.document));
  const pdf = await PDFDocument.load(await exportPdf(reopened));
  const dict = pdf.getPage(0).node.Annots()!.lookup(0, PDFDict);
  expect(dict.lookup(PDFName.of("Contents"), PDFHexString).decodeText()).toBe("新コメント");
});
it("rejects malformed CSV, bad pages and unsupported status before any document mutation", () => {
  const d = model(), before = structuredClone(d);
  for (const text of [header, header + '1,,未確認,"unclosed,追加', header + '1,,未確認,"x"junk,追加', header + '3,,未確認,x,追加',
    header + '1,,unknown,x,追加', header + '1,,未確認,x,unknown', header + '1,,未確認,x,追加,extra', 'page,author,text\n1,a,b'])
    expect(() => parseCommentsCsv(encode(text), d)).toThrow();
  expect(d).toEqual(before);
  expect(() => parseCommentsCsv(new Uint8Array(8 * 1024 * 1024 + 1), d)).toThrow();
});
it("supports UTF16 and preserves literal spreadsheet escaping without evaluating it", () => {
  const text = header + '1,山田,未確認,\'=SUM(A1),既存', data = new Uint8Array(2 + text.length * 2);
  data.set([255, 254]); Array.from(text).forEach((c, i) => { data[2 + i * 2] = c.charCodeAt(0) & 255; data[3 + i * 2] = c.charCodeAt(0) >> 8; });
  expect(parseCommentsCsv(data, model())[0].markup.text).toBe("'=SUM(A1)");
});
