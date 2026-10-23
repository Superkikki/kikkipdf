import { expect, it } from "vitest";
import { PDFDocument, PDFDict, PDFName, PDFHexString } from "pdf-lib";
import { emptyDocument, blankPage, type BookmarkModel } from "../src/state/model";
import { History } from "../src/commands/history";
import { bookmarksJson, readBookmarkFile, importBookmarks, bookmarkDeletionPlan, deleteMatchingBookmarks, MAX_BOOKMARK_FILE_BYTES, type BookmarkFile } from "../src/pages/bookmarkTransfer";
import { exportPdf } from "../src/export/engine";
import { saveProject, openProject } from "../src/state/project";
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function fixture() {
  const d = emptyDocument("private.pdf"); d.pages = [blankPage(), blankPage(), blankPage()]; d.path = "C:/private/source.pdf";
  d.bookmarks = [{ id: "root", title: "資料", expanded: false, color: "#336699", bold: true, italic: true, children: [
    { id: "page", title: "ＰＡＧＥ", pageId: d.pages[1].id, destination: { kind: "XYZ", left: 10, top: 300, zoom: 2 }, children: [] },
    { id: "url", title: "Link", url: "https://example.com/", children: [] },
  ] }];
  return d;
}
it("round-trips portable hierarchy, page offsets, destinations, URLs, styles and independent identities with undo/project/PDF", async () => {
  const source = fixture(), encoded = bookmarksJson(source), text = new TextDecoder().decode(encoded), file = readBookmarkFile(encoded);
  expect(text).not.toContain('"id"'); expect(text).not.toContain('pageId'); expect(text).not.toContain('private');
  expect(file.bookmarks[0].children[0].page).toBe(2);
  expect(readBookmarkFile(new Uint8Array([239,187,191,...encoded]))).toEqual(file);
  const target = fixture(), h = new History(target); h.execute(importBookmarks(target, file, 1));
  const revision = h.current, copy = revision.document.bookmarks![1];
  expect(copy.id).not.toBe("root"); expect(copy.children[0].pageId).toBe(target.pages[2].id);
  expect(copy.children[0].destination).toEqual(source.bookmarks![0].children[0].destination);
  expect(copy.children[1].url).toBe("https://example.com/"); expect(copy.expanded).toBe(false); expect(copy.color).toBe("#336699"); expect(copy.bold && copy.italic).toBe(true);
  h.undo(); expect(h.current.document).toBe(target); h.redo(); expect(h.current).toBe(revision);
  const reopened = await openProject(await saveProject(revision.document)); expect(reopened.bookmarks).toEqual(revision.document.bookmarks);
  const pdf = await PDFDocument.load(await exportPdf(reopened)), n = PDFName.of;
  const root = pdf.catalog.lookup(n("Outlines"), PDFDict).lookup(n("First"), PDFDict).lookup(n("Next"), PDFDict);
  expect(root.lookup(n("Title"), PDFHexString).decodeText()).toBe("資料");
  expect(root.get(n("Count"))?.toString()).toBe("-2");
  const page = root.lookup(n("First"), PDFDict); expect(page.get(n("Dest"))?.toString()).toContain("/XYZ 10 300 2");
  const negative = new History(target); negative.execute(importBookmarks(target, file, -1)); expect(negative.current.document.bookmarks![1].children[0].pageId).toBe(target.pages[0].id);
});
it("rejects malformed/oversized data, unsafe URLs, unknown fields and unsupported versions", () => {
  const valid = readBookmarkFile(bookmarksJson(fixture()));
  expect(() => readBookmarkFile(new Uint8Array(MAX_BOOKMARK_FILE_BYTES + 1))).toThrow(/8MB/);
  for (const value of [new Uint8Array([255]), new TextEncoder().encode('{"bad":'), bytes({ ...valid, version: 2 }), bytes({ ...valid, execute: "action" })]) expect(() => readBookmarkFile(value)).toThrow();
  const badNodes = [
    { title: "x", children: [], url: "javascript:alert(1)" },
    { title: "x", children: [], page: 0 }, { title: "x", children: [], page: 4 },
    { title: "x", children: [], page: 1, url: "https://example.com" },
    { title: "x", children: [], destination: { kind: "Fit" } },
    { title: "x", children: [], color: "red" }, { title: "x", children: [], action: "Launch" },
    { title: "x", children: [], page: 1, destination: { kind: "XYZ", left: null, top: null, zoom: 101 } },
  ];
  for (const node of badNodes) expect(() => readBookmarkFile(bytes({ ...valid, bookmarks: [node] }))).toThrow();
});
it("checks depth/count bounds and rejects out-of-range offsets, stale documents and over-budget imports atomically", () => {
  const target = fixture(), valid = readBookmarkFile(bookmarksJson(target)), h = new History(target);
  for (const offset of [2, -2, 0.5, NaN, 10000]) expect(() => h.execute(importBookmarks(target, valid, offset))).toThrow();
  expect(h.canUndo).toBe(false); expect(h.current.document).toBe(target);
  expect(() => importBookmarks(target, valid, 0).apply({ ...target })).toThrow(/変更/);
  let deep: BookmarkFile["bookmarks"] = [];
  for (let i = 0; i < 24; i++) deep = [{ title: "Heading", children: deep }];
  expect(readBookmarkFile(bytes({ ...valid, bookmarks: deep })).bookmarks).toEqual(deep);
  expect(() => readBookmarkFile(bytes({ ...valid, bookmarks: [{ title: "Too deep", children: deep }] }))).toThrow(/24階層/);
  const many = Array.from({ length: 10001 }, () => ({ title: "Node", children: [] }));
  expect(() => readBookmarkFile(bytes({ ...valid, bookmarks: many }))).toThrow(/10000/);
  const full = fixture(); full.bookmarks = Array.from({ length: 10000 }, (_, i) => ({ id: `node${i}`, title: "Node", children: [] }));
  expect(() => new History(full).execute(importBookmarks(full, valid, 0))).toThrow(/10000/);
  const empty = new History(target); empty.execute(importBookmarks(target, { ...valid, bookmarks: [] }, 0)); expect(empty.canUndo).toBe(false);
});
it("deletes only matching branches, counts descendants once, preserves ancestors and supports undo/project/PDF", async () => {
  const d = fixture(), original = d.bookmarks![0], h = new History(d);
  expect(bookmarkDeletionPlan(d, "page")).toMatchObject({ matched: 1, removed: 1 });
  expect(bookmarkDeletionPlan(d, "資料")).toMatchObject({ matched: 1, removed: 3 });
  expect(bookmarkDeletionPlan(d, "")).toMatchObject({ matched: 3, removed: 3 });
  h.execute(deleteMatchingBookmarks(d, "page")); expect(h.current.document.bookmarks![0].children).toEqual([original.children[1]]);
  expect(d.bookmarks![0]).toBe(original); expect(original.children).toHaveLength(2);
  const after = h.current; h.undo(); expect(h.current.document).toBe(d); h.redo(); expect(h.current).toBe(after);
  const reopened = await openProject(await saveProject(after.document)); expect(reopened.bookmarks).toEqual(after.document.bookmarks);
  const pdf = await PDFDocument.load(await exportPdf(reopened)); expect(pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict).get(PDFName.of("Count"))?.toString()).toBe("1");
  expect(() => deleteMatchingBookmarks(d, "資料").apply(after.document)).toThrow(/変更/);
  const clean = new History(d); clean.execute(deleteMatchingBookmarks(d, "missing")); expect(clean.canUndo).toBe(false);
  clean.execute(deleteMatchingBookmarks(d, "")); expect(clean.current.document.bookmarks).toEqual([]);
});
it("rejects duplicate existing IDs and cycles before exporting or planning a deletion", () => {
  const d = fixture(); d.bookmarks!.push({ ...d.bookmarks![0] }); expect(() => bookmarksJson(d)).toThrow(/ID/);
  const loop: BookmarkModel = { id: "loop", title: "Loop", children: [] }; loop.children.push(loop); d.bookmarks = [loop];
  expect(() => bookmarkDeletionPlan(d, "Loop")).toThrow(/ID/);
});
