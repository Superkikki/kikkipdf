import { it, expect, describe } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFArray } from "pdf-lib";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { emptyDocument, blankPage, newObject } from "../src/state/model";
import { saveProject, openProject } from "../src/state/project";
import { exportPdf } from "../src/export/engine";
import {
  addBookmark,
  moveBookmark,
  updateBookmark,
} from "../src/pages/bookmarks";
import { History } from "../src/commands/history";

describe("editable project archive", () => {
  it("round-trips original bytes, editable objects and form/bookmark state without native paths", async () => {
    const d = emptyDocument("test.pdf");
    d.path = "C:/private/original.pdf";
    const source = await PDFDocument.create();
    source.addPage();
    d.sources.a = { id: "a", name: "original.pdf", bytes: await source.save() };
    d.pages = [
      {
        ...blankPage(),
        sourceId: "a",
        objects: [{ ...newObject("text", 12, 34), text: "続きから編集" }],
      },
    ];
    d.bookmarks = [
      { id: "b", title: "目次", pageId: d.pages[0].id, children: [] },
    ];
    const reopened = await openProject(await saveProject(d));
    expect(reopened.path).toBeUndefined();
    expect(reopened.pages).toEqual(d.pages);
    expect(reopened.sources.a.bytes).toEqual(d.sources.a.bytes);
    expect(reopened.bookmarks).toEqual(d.bookmarks);
  });
  it("rejects corrupt binary assets, unsupported versions and unsafe archive entries", async () => {
    const d = emptyDocument();
    d.pages = [blankPage()];
    d.sources.a = { id: "a", name: "a.pdf", bytes: new Uint8Array([1, 2, 3]) };
    const files = unzipSync(await saveProject(d));
    files["sources/0.pdf"][0] = 9;
    await expect(openProject(zipSync(files))).rejects.toThrow("整合性");
    const meta = JSON.parse(strFromU8(files["document.json"]));
    meta.version = 999;
    files["document.json"] = strToU8(JSON.stringify(meta));
    await expect(openProject(zipSync(files))).rejects.toThrow("バージョン");
    await expect(
      openProject(zipSync({ "../../outside.txt": strToU8("no") })),
    ).rejects.toThrow("不正");
  });
});

describe("editable PDF outlines", () => {
  it("supports nested move/rename/undo without cycles", () => {
    const d = emptyDocument();
    d.pages = [blankPage()];
    const h = new History(d);
    h.execute(addBookmark({ id: "a", title: "A", children: [] }));
    h.execute(addBookmark({ id: "b", title: "B", children: [] }));
    h.execute(moveBookmark("b", "a", 0));
    expect(h.current.document.bookmarks?.[0].children[0].id).toBe("b");
    const before = h.current.document;
    h.execute(moveBookmark("a", "b", 0));
    expect(h.current.document).toBe(before);
    h.execute(updateBookmark("b", { title: "章" }));
    h.undo();
    expect(h.current.document.bookmarks?.[0].children[0].title).toBe("B");
  });
  it("writes valid linked outlines targeting exported page order, pruning removed destinations", async () => {
    const d = emptyDocument();
    d.pages = [blankPage(), blankPage(), blankPage()];
    d.bookmarks = [
      {
        id: "root",
        title: "目次",
        children: [
          { id: "a", title: "最初", pageId: d.pages[0].id, children: [] },
          {
            id: "b",
            title: "削除されるページ",
            pageId: d.pages[1].id,
            children: [],
          },
          { id: "c", title: "最後", pageId: d.pages[2].id, children: [] },
        ],
      },
    ];
    const pdf = await PDFDocument.load(
      await exportPdf(d, undefined, { indices: [2, 0] }),
    );
    const outline = pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict),
      root = outline.lookup(PDFName.of("First"), PDFDict);
    const first = root.lookup(PDFName.of("First"), PDFDict),
      last = root.lookup(PDFName.of("Last"), PDFDict);
    expect(first.lookup(PDFName.of("Dest"), PDFArray).get(0)).toEqual(
      pdf.getPage(1).ref,
    );
    expect(last.lookup(PDFName.of("Dest"), PDFArray).get(0)).toEqual(
      pdf.getPage(0).ref,
    );
    expect(first.lookup(PDFName.of("Next"), PDFDict)).toBe(last);
    expect(root.get(PDFName.of("Count"))?.toString()).toBe("2");
  });
});

it("preserves closed outline state and counts only visible descendants in PDF and project round trips", async () => {
  const { setBookmarksExpanded } = await import("../src/pages/bookmarks");
  const model = emptyDocument();
  model.pages = [blankPage()];
  model.bookmarks = [
    {
      id: "root",
      title: "Root",
      expanded: false,
      children: [
        {
          id: "a",
          title: "A",
          expanded: false,
          children: [{ id: "a1", title: "A1", children: [] }],
        },
        {
          id: "b",
          title: "B",
          expanded: true,
          children: [
            { id: "b1", title: "B1", children: [] },
            { id: "b2", title: "B2", children: [] },
          ],
        },
      ],
    },
  ];
  const restored = await openProject(await saveProject(model));
  expect(restored.bookmarks).toEqual(model.bookmarks);
  const pdf = await PDFDocument.load(await exportPdf(restored));
  const outline = pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict),
    root = outline.lookup(PDFName.of("First"), PDFDict);
  expect(outline.get(PDFName.of("Count"))?.toString()).toBe("1");
  expect(root.get(PDFName.of("Count"))?.toString()).toBe("-4");
  expect(
    root
      .lookup(PDFName.of("First"), PDFDict)
      .get(PDFName.of("Count"))
      ?.toString(),
  ).toBe("-1");
  expect(
    root
      .lookup(PDFName.of("Last"), PDFDict)
      .get(PDFName.of("Count"))
      ?.toString(),
  ).toBe("2");
  const history = new History(restored);
  history.execute(setBookmarksExpanded(true));
  const opened = await PDFDocument.load(
    await exportPdf(history.current.document),
  );
  const openedOutline = opened.catalog.lookup(PDFName.of("Outlines"), PDFDict);
  expect(openedOutline.get(PDFName.of("Count"))?.toString()).toBe("6");
  expect(
    openedOutline
      .lookup(PDFName.of("First"), PDFDict)
      .get(PDFName.of("Count"))
      ?.toString(),
  ).toBe("5");
  history.undo();
  expect(history.current.document.bookmarks).toEqual(model.bookmarks);
  history.redo();
  history.execute(setBookmarksExpanded(false));
  expect(
    history.current.document.bookmarks![0].children.every(
      (b) => b.expanded === false,
    ),
  ).toBe(true);
  const collapsed = history.current.document;
  expect(setBookmarksExpanded(false).apply(collapsed)).toBe(collapsed);
  const empty = emptyDocument();
  expect(setBookmarksExpanded(true).apply(empty)).toBe(empty);
});

it("searches bookmark names with normalized text and keeps ancestor paths without changing stored folding", async () => {
  const { filterBookmarks } = await import("../src/pages/bookmarks");
  const nodes = [
    {
      id: "root",
      title: "Root",
      expanded: false,
      children: [
        { id: "a", title: "ＡＢＣ資料", children: [] },
        { id: "b", title: "別の章", children: [] },
      ],
    },
  ];
  expect(filterBookmarks(nodes, " abc ")[0]).toMatchObject({
    id: "root",
    expanded: false,
    children: [{ id: "a" }],
  });
  expect(filterBookmarks(nodes, "ROOT")).toEqual(nodes);
  expect(filterBookmarks(nodes, "missing")).toEqual([]);
  expect(filterBookmarks(nodes, " ")).toBe(nodes);
  expect(nodes[0].children).toHaveLength(2);
});
