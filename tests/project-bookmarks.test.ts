import { it, expect, describe } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFNumber } from "pdf-lib";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { emptyDocument, blankPage, newObject, type BookmarkDestination } from "../src/state/model";
import { saveProject, openProject } from "../src/state/project";
import { exportPdf } from "../src/export/engine";
import {
  addBookmark,
  moveBookmark,
  readBookmarks,
  updateBookmark,
} from "../src/pages/bookmarks";
import { History } from "../src/commands/history";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

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

it("round-trips external bookmark URLs, nested URLs, and keeps them when extracting pages", async () => {
  const model = emptyDocument();
  model.pages = [blankPage(), blankPage()];
  model.bookmarks = [
    {
      id: "root",
      title: "外部リンク",
      url: "https://example.com/日本語?q=1",
      children: [
        {
          id: "mail",
          title: "メール",
          url: "mailto:hello@example.com",
          children: [],
        },
        {
          id: "removed",
          title: "抽出外ページ",
          pageId: model.pages[1].id,
          children: [],
        },
      ],
    },
    {
      id: "kept-page",
      title: "抽出対象ページ",
      pageId: model.pages[0].id,
      children: [],
    },
  ];

  const restored = await openProject(await saveProject(model));
  expect(restored.bookmarks).toEqual(model.bookmarks);

  const full = await PDFDocument.load(await exportPdf(restored));
  const root = full.catalog
    .lookup(PDFName.of("Outlines"), PDFDict)
    .lookup(PDFName.of("First"), PDFDict);
  const rootAction = root.lookup(PDFName.of("A"), PDFDict);
  expect(rootAction.lookup(PDFName.of("S"))?.toString()).toBe("/URI");
  expect(rootAction.lookup(PDFName.of("URI"), PDFString).decodeText()).toContain(
    "https://example.com/%E6%97%A5",
  );
  const mail = root.lookup(PDFName.of("First"), PDFDict);
  expect(
    mail.lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI"), PDFString).decodeText(),
  ).toBe("mailto:hello@example.com");

  const extracted = await PDFDocument.load(
    await exportPdf(restored, undefined, { indices: [0] }),
  );
  const extractedOutline = extracted.catalog.lookup(PDFName.of("Outlines"), PDFDict);
  const extractedRoot = extractedOutline.lookup(PDFName.of("First"), PDFDict);
  expect(extractedRoot.lookup(PDFName.of("A"), PDFDict)).toBeTruthy();
  expect(extractedRoot.lookup(PDFName.of("First"), PDFDict)).toBeTruthy();
  expect(extractedRoot.lookup(PDFName.of("First"), PDFDict).lookup(PDFName.of("Title"), PDFHexString).decodeText()).toBe("メール");
  expect(extractedOutline.lookup(PDFName.of("Last"), PDFDict).lookup(PDFName.of("Title"), PDFHexString).decodeText()).toBe("抽出対象ページ");
  expect(extractedRoot.lookup(PDFName.of("First"), PDFDict).has(PDFName.of("Dest"))).toBe(false);
});

it("switches bookmark URL and page destinations with undo and redo", () => {
  const model = emptyDocument();
  model.pages = [blankPage()];
  model.bookmarks = [
    { id: "item", title: "移動先", pageId: model.pages[0].id, children: [] },
  ];
  const history = new History(model);
  history.execute(updateBookmark("item", { url: "mailto:hello@example.com" }));
  expect(history.current.document.bookmarks?.[0]).toMatchObject({
    url: "mailto:hello@example.com",
  });
  expect(history.current.document.bookmarks?.[0].pageId).toBeUndefined();
  history.undo();
  expect(history.current.document.bookmarks?.[0].pageId).toBe(model.pages[0].id);
  expect(history.current.document.bookmarks?.[0].url).toBeUndefined();
  history.redo();
  expect(history.current.document.bookmarks?.[0].url).toBe("mailto:hello@example.com");
  history.execute(updateBookmark("item", { pageId: model.pages[0].id }));
  expect(history.current.document.bookmarks?.[0].pageId).toBe(model.pages[0].id);
  expect(history.current.document.bookmarks?.[0].url).toBeUndefined();
  history.undo();
  expect(history.current.document.bookmarks?.[0].url).toBe("mailto:hello@example.com");
});

it("rejects unsafe bookmark URLs and ambiguous destinations on PDF export and project load", async () => {
  const model = emptyDocument();
  model.pages = [blankPage()];
  model.bookmarks = [
    { id: "bad-url", title: "危険URL", url: "javascript:alert(1)", children: [] },
  ];
  await expect(exportPdf(model)).rejects.toThrow();

  const ambiguous = emptyDocument();
  ambiguous.pages = [blankPage()];
  ambiguous.bookmarks = [
    {
      id: "ambiguous",
      title: "二重宛先",
      pageId: ambiguous.pages[0].id,
      url: "https://example.com/",
      children: [],
    },
  ];
  await expect(exportPdf(ambiguous)).rejects.toThrow();
  await expect(saveProject(ambiguous)).rejects.toThrow();

  const valid = emptyDocument();
  valid.pages = [blankPage()];
  valid.bookmarks = [{ id: "valid", title: "有効", children: [] }];
  const files = unzipSync(await saveProject(valid));
  const manifest = JSON.parse(strFromU8(files["document.json"]));
  manifest.document.bookmarks[0].pageId = valid.pages[0].id;
  manifest.document.bookmarks[0].url = "https://example.com/";
  files["document.json"] = strToU8(JSON.stringify(manifest));
  await expect(openProject(zipSync(files))).rejects.toThrow();
});

it("imports and validates outline URLs, decodes unsafe UTF-16 URLs, and prefers resolved pages", async () => {
  const utf16Bytes = new Uint8Array([
    0xfe, 0xff, 0x00, 0x68, 0x00, 0x74, 0x00, 0x74, 0x00, 0x70, 0x00, 0x73,
    0x00, 0x3a, 0x00, 0x2f, 0x00, 0x2f, 0x00, 0x65, 0x00, 0x78, 0x00, 0x61,
    0x00, 0x6d, 0x00, 0x70, 0x00, 0x6c, 0x00, 0x65, 0x00, 0x2e, 0x00, 0x63,
    0x00, 0x6f, 0x00, 0x6d, 0x00, 0x2f,
  ]);
  const unsafeUrl = String.fromCharCode(...utf16Bytes);
  const outline = [
    { title: "正規化", url: " https://example.com/日本語 ", items: [] },
    { title: "UTF-16 unsafeUrl", unsafeUrl, items: [] },
    { title: "危険URL", url: "javascript:alert(1)", items: [] },
    { title: "内部優先", dest: [0, { name: "Fit" }], url: "https://ignored.example/", items: [] },
  ];
  const pdf = {
    getOutline: async () => outline,
    getDestination: async () => null,
    getPageIndex: async () => 0,
  } as unknown as PDFDocumentProxy;
  const pages = [{ ...blankPage(), id: "page-1" }];
  const bookmarks = await readBookmarks(pdf, pages);
  expect(bookmarks[0].url).toBe("https://example.com/%E6%97%A5%E6%9C%AC%E8%AA%9E");
  expect(bookmarks[1].url).toBe("https://example.com/");
  expect(bookmarks[2].url).toBeUndefined();
  expect(bookmarks[2].pageId).toBeUndefined();
  expect(bookmarks[3].pageId).toBe("page-1");
  expect(bookmarks[3].url).toBeUndefined();
});

it("imports outline RGB color and PDF bold/italic flag bits", async () => {
  const outline = [
    {
      title: "色と両書式",
      color: new Uint8ClampedArray([18, 52, 86]),
      bold: true,
      italic: true,
      dest: null,
      url: null,
      unsafeUrl: undefined,
      count: undefined,
      items: [],
    },
    {
      title: "黒と斜体",
      color: new Uint8ClampedArray([0, 0, 0]),
      bold: false,
      italic: true,
      dest: null,
      url: null,
      unsafeUrl: undefined,
      count: undefined,
      items: [],
    },
    {
      title: "既定",
      color: new Uint8ClampedArray([0, 0, 0]),
      bold: false,
      italic: false,
      dest: null,
      url: null,
      unsafeUrl: undefined,
      count: undefined,
      items: [],
    },
  ];
  const pdf = {
    getOutline: async () => outline,
    getDestination: async () => null,
    getPageIndex: async () => 0,
  } as unknown as PDFDocumentProxy;
  const nodes = await readBookmarks(pdf, []);
  expect(nodes[0]).toMatchObject({ color: "#123456", bold: true, italic: true });
  expect(nodes[1]).toMatchObject({ italic: true });
  expect(nodes[1].color).toBeUndefined();
  expect(nodes[1].bold).toBeUndefined();
  expect(nodes[2].color).toBeUndefined();
  expect(nodes[2].bold).toBeUndefined();
  expect(nodes[2].italic).toBeUndefined();
});

it("writes bookmark color and style flags, persists edits, and clears default formatting", async () => {
  const model = emptyDocument();
  model.pages = [blankPage()];
  model.bookmarks = [{ id: "styled", title: "書式", children: [] }];
  const history = new History(model);
  history.execute(
    updateBookmark("styled", {
      color: "#123456",
      bold: true,
      italic: true,
    }),
  );
  const savedProject = await openProject(
    await saveProject(history.current.document),
  );
  expect(savedProject.bookmarks?.[0]).toMatchObject({
    color: "#123456",
    bold: true,
    italic: true,
  });
  const output = await PDFDocument.load(await exportPdf(savedProject));
  const styled = output.catalog
    .lookup(PDFName.of("Outlines"), PDFDict)
    .lookup(PDFName.of("First"), PDFDict);
  const color = styled.lookup(PDFName.of("C"), PDFArray);
  expect(color.size()).toBe(3);
  expect((color.get(0) as PDFNumber).asNumber()).toBeCloseTo(18 / 255);
  expect((color.get(1) as PDFNumber).asNumber()).toBeCloseTo(52 / 255);
  expect((color.get(2) as PDFNumber).asNumber()).toBeCloseTo(86 / 255);
  expect(styled.lookup(PDFName.of("F"), PDFNumber).asNumber()).toBe(3);

  history.undo();
  expect(history.current.document.bookmarks?.[0].color).toBeUndefined();
  expect(history.current.document.bookmarks?.[0].bold).toBeUndefined();
  expect(history.current.document.bookmarks?.[0].italic).toBeUndefined();
  history.redo();
  expect(history.current.document.bookmarks?.[0]).toMatchObject({
    color: "#123456",
    bold: true,
    italic: true,
  });

  history.execute(
    updateBookmark("styled", { color: undefined, bold: false, italic: false }),
  );
  const defaults = await PDFDocument.load(
    await exportPdf(history.current.document),
  );
  const defaultNode = defaults.catalog
    .lookup(PDFName.of("Outlines"), PDFDict)
    .lookup(PDFName.of("First"), PDFDict);
  expect(defaultNode.has(PDFName.of("C"))).toBe(false);
  expect(defaultNode.has(PDFName.of("F"))).toBe(false);
});

it("rejects invalid bookmark colors in PDF and project saves", async () => {
  const model = emptyDocument();
  model.pages = [blankPage()];
  model.bookmarks = [
    { id: "invalid", title: "不正色", color: "#12xz56", children: [] },
  ];
  await expect(exportPdf(model)).rejects.toThrow();
  await expect(saveProject(model)).rejects.toThrow();
});

it("imports every supported page-view destination with its raw parameters", async () => {
  const cases = [
    ["XYZ", 12, null, 0], ["XYZ", null, 24, null],
    ["Fit"], ["FitB"], ["FitH", null], ["FitH", 17],
    ["FitBH", -9], ["FitV", null], ["FitV", 31], ["FitBV", 0],
    ["FitR", 1, 2, 30, 40],
  ] as const;
  const outline = cases.map(([kind, ...parameters], i) => ({
    title: `destination-${i}`,
    dest: [0, { name: kind }, ...parameters],
    items: [],
  }));
  const pdf = {
    getOutline: async () => outline,
    getDestination: async () => null,
    getPageIndex: async () => 0,
  } as unknown as PDFDocumentProxy;
  const nodes = await readBookmarks(pdf, [{ ...blankPage(), id: "page-1" }]);
  expect(nodes.map((b) => b.destination)).toEqual(cases.map(([kind, ...p]) => {
    switch (kind) {
      case "XYZ": return { kind, left: p[0], top: p[1], zoom: p[2] };
      case "FitH": case "FitBH": return { kind, top: p[0] };
      case "FitV": case "FitBV": return { kind, left: p[0] };
      case "FitR": return { kind, left: p[0], bottom: p[1], right: p[2], top: p[3] };
      default: return { kind };
    }
  }));
  expect(nodes.every((b) => b.pageId === "page-1")).toBe(true);
});

it("resolves named destinations and leaves malformed views as page bookmarks", async () => {
  const outline = [
    { title: "名前付き", dest: "named", items: [] },
    { title: "不正XYZ", dest: [0, { name: "XYZ" }, Infinity, 2, 0], items: [] },
    { title: "不正FitR", dest: [0, { name: "FitR" }, 9, 0, 1, 2], items: [] },
    { title: "未知", dest: [0, { name: "FitZ" }], items: [] },
  ];
  const pdf = {
    getOutline: async () => outline,
    getDestination: async (name: string) => name === "named"
      ? [0, { name: "XYZ" }, 3, null, 0]
      : null,
    getPageIndex: async () => 0,
  } as unknown as PDFDocumentProxy;
  const nodes = await readBookmarks(pdf, [{ ...blankPage(), id: "page-1" }]);
  expect(nodes[0]).toMatchObject({ pageId: "page-1", destination: { kind: "XYZ", left: 3, top: null, zoom: 0 } });
  expect(nodes.slice(1).map((b) => b.pageId)).toEqual(["page-1", "page-1", "page-1"]);
  expect(nodes.slice(1).map((b) => b.destination)).toEqual([undefined, undefined, undefined]);
});

it("exports raw page-view parameters after page reorder, crop and rotation", async () => {
  const model = emptyDocument();
  const a = { ...blankPage(), rotation: 90 as const, crop: { x: 10, y: 20, width: 200, height: 300 } };
  const b = { ...blankPage(), rotation: 270 as const, crop: { x: 5, y: 6, width: 70, height: 80 } };
  model.pages = [a, b];
  model.bookmarks = [
    { id: "a", title: "範囲", pageId: a.id, destination: { kind: "FitR", left: 11, bottom: 22, right: 33, top: 44 }, children: [] },
    { id: "b", title: "XYZ", pageId: b.id, destination: { kind: "XYZ", left: null, top: 47, zoom: 0 }, children: [] },
  ];
  const pdf = await PDFDocument.load(await exportPdf(model, undefined, { indices: [1, 0] }));
  const nodes = pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict).lookup(PDFName.of("First"), PDFDict);
  const asNumbers = (arr: PDFArray) => Array.from({ length: arr.size() }, (_, i) => {
    const value = arr.get(i);
    return value instanceof PDFNumber ? value.asNumber() : value.toString();
  });
  const firstDest = nodes.lookup(PDFName.of("Dest"), PDFArray);
  const nextDest = nodes.lookup(PDFName.of("Next"), PDFDict).lookup(PDFName.of("Dest"), PDFArray);
  expect(firstDest.get(0)).toEqual(pdf.getPage(1).ref);
  expect(asNumbers(firstDest).slice(1)).toEqual(["/FitR", 11, 22, 33, 44]);
  expect(nextDest.get(0)).toEqual(pdf.getPage(0).ref);
  expect(asNumbers(nextDest).slice(1)).toEqual(["/XYZ", "null", 47, 0]);
  const extracted = await PDFDocument.load(await exportPdf(model, undefined, { indices: [0] }));
  const extractedNode = extracted.catalog.lookup(PDFName.of("Outlines"), PDFDict).lookup(PDFName.of("First"), PDFDict);
  expect(asNumbers(extractedNode.lookup(PDFName.of("Dest"), PDFArray)).slice(1)).toEqual(["/FitR", 11, 22, 33, 44]);
  expect(extractedNode.get(PDFName.of("Next"))).toBeUndefined();
});

it("round-trips page-view destinations through project history and clears them on destination changes", async () => {
  const model = emptyDocument();
  model.pages = [blankPage(), blankPage()];
  const [first, second] = model.pages;
  model.bookmarks = [{ id: "view", title: "表示位置", pageId: first.id, destination: { kind: "FitH", top: null }, children: [] }];
  const restored = await openProject(await saveProject(model));
  expect(restored.bookmarks).toEqual(model.bookmarks);
  const history = new History(restored);
  history.execute(updateBookmark("view", { pageId: second.id }));
  expect(history.current.document.bookmarks?.[0]).toMatchObject({ pageId: second.id });
  expect(history.current.document.bookmarks?.[0].destination).toBeUndefined();
  history.undo();
  expect(history.current.document.bookmarks).toEqual(model.bookmarks);
  history.redo();
  history.execute(updateBookmark("view", { pageId: first.id, destination: { kind: "XYZ", left: 0, top: null, zoom: null } }));
  expect(history.current.document.bookmarks?.[0].destination).toEqual({ kind: "XYZ", left: 0, top: null, zoom: null });
  history.execute(updateBookmark("view", { url: "https://example.com/" }));
  expect(history.current.document.bookmarks?.[0].destination).toBeUndefined();
  history.undo();
  expect(history.current.document.bookmarks?.[0].destination).toEqual({ kind: "XYZ", left: 0, top: null, zoom: null });
});

it("rejects invalid or page-less page-view destinations on export and project save", async () => {
  const invalid = [
    { kind: "XYZ", left: 0, top: 0, zoom: 101 },
    { kind: "FitR", left: 5, bottom: 0, right: 5, top: 1 },
    { kind: "FitH", top: Infinity },
  ] as const;
  for (const destination of invalid) {
    const model = emptyDocument();
    model.pages = [blankPage()];
    model.bookmarks = [{ id: "invalid", title: "不正", pageId: model.pages[0].id, destination: destination as unknown as BookmarkDestination, children: [] }];
    await expect(exportPdf(model)).rejects.toThrow();
    await expect(saveProject(model)).rejects.toThrow();
  }
  const orphan = emptyDocument();
  orphan.pages = [blankPage()];
  orphan.bookmarks = [{ id: "orphan", title: "ページなし", destination: { kind: "Fit" }, children: [] }];
  await expect(exportPdf(orphan)).rejects.toThrow();
  await expect(saveProject(orphan)).rejects.toThrow();
});
