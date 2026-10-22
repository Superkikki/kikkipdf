import { expect, it } from "vitest";
import { emptyDocument, blankPage, type BookmarkModel } from "../src/state/model";
import { History } from "../src/commands/history";
import { duplicateBookmark, updateBookmark } from "../src/pages/bookmarks";
import { openProject, saveProject } from "../src/state/project";
import { exportPdf } from "../src/export/engine";
import { PDFDocument, PDFDict, PDFName, PDFHexString } from "pdf-lib";

it("duplicates a nested subtree with independent identities, preserved destinations/styles, undo and project/PDF persistence", async () => {
  const d = emptyDocument(); d.pages = [blankPage()];
  const branch: BookmarkModel = { id: "branch", title: "Chapter", expanded: false, color: "#336699", bold: true, italic: true,
    pageId: d.pages[0].id, destination: { kind: "XYZ", left: 10, top: 300, zoom: 2 },
    children: [{ id: "leaf", title: "Link", url: "https://example.com/", children: [] }] };
  d.bookmarks = [{ id: "root", title: "Root", children: [branch] }];
  const h = new History(d); h.execute(duplicateBookmark("branch", "copy"));
  const current = h.current, children = current.document.bookmarks![0].children, copy = children[1];
  expect(children[0]).toEqual(branch); expect(copy).toEqual({ ...branch, id: "copy", title: "Chapter（コピー）", children: [{ ...branch.children[0], id: expect.any(String) }] });
  expect(copy.destination).not.toBe(branch.destination); expect(copy.children[0].id).not.toBe("leaf");
  h.undo(); expect(h.current.document).toBe(d); h.redo(); expect(h.current).toBe(current);
  h.execute(updateBookmark(copy.children[0].id, { title: "Independent" }));
  expect(h.current.document.bookmarks![0].children[0].children[0].title).toBe("Link");
  const restored = await openProject(await saveProject(h.current.document)); expect(restored.bookmarks).toEqual(h.current.document.bookmarks);
  const pdf = await PDFDocument.load(await exportPdf(restored)), n = PDFName.of;
  const root = pdf.catalog.lookup(n("Outlines"), PDFDict).lookup(n("First"), PDFDict);
  const saved = root.lookup(n("First"), PDFDict).lookup(n("Next"), PDFDict);
  expect(saved.lookup(n("Title"), PDFHexString).decodeText()).toBe("Chapter（コピー）");
  expect(saved.get(n("Count"))?.toString()).toBe("-1"); expect(saved.get(n("Dest"))?.toString()).toContain("/XYZ 10 300 2");
});

it("duplicates roots and rejects collisions, missing nodes and size/depth limits atomically", () => {
  const d = emptyDocument(); d.bookmarks = [{ id: "root", title: "Root", children: [] }];
  const h = new History(d);
  for (const [id, copy] of [["missing", "new"], ["root", "root"], ["root", "__proto__"]]) expect(() => h.execute(duplicateBookmark(id, copy))).toThrow();
  expect(h.canUndo).toBe(false); expect(h.current.document).toBe(d);
  h.execute(duplicateBookmark("root", "copy")); expect(h.current.document.bookmarks?.map(b => b.id)).toEqual(["root", "copy"]);
  const large = emptyDocument(); large.bookmarks = Array.from({ length: 10000 }, (_, i) => ({ id: `n${i}`, title: "Node", children: [] }));
  const full = new History(large); expect(() => full.execute(duplicateBookmark("n0"))).toThrow(/10000/); expect(full.current.document).toBe(large);
  const deep = emptyDocument(); let node: BookmarkModel = { id: "leaf", title: "Leaf", children: [] };
  for (let i = 0; i < 24; i++) node = { id: `d${i}`, title: "Heading", children: [node] };
  deep.bookmarks = [node]; expect(() => new History(deep).execute(duplicateBookmark(node.id))).toThrow(/24階層/);
});
