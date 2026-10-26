import { expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parsePageOrder, pageOrderPreset, reorderAllPages } from "../src/pages/order";
import { emptyDocument, blankPage, newObject } from "../src/state/model";
import { History } from "../src/commands/history";
import { exportPdf } from "../src/export/engine";
import { openProject, saveProject } from "../src/state/project";
GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

it("parses complete ascending/descending permutations and rejects missing, repeated and out-of-range pages with bounded work", () => {
  expect(parsePageOrder(" 3-1, 4-6 ", 6)).toEqual([2, 1, 0, 3, 4, 5]);
  expect(parsePageOrder("1", 1)).toEqual([0]); expect(parsePageOrder("10000-1", 10000)).toHaveLength(10000);
  for (const value of ["", "1-2", "1-3,3", "1-3,", "0,1-3", "4,1-3", "1.5,2,3", "1e1", "1;2;3", "1-99999999999999999999999999", "１-３", "x".repeat(100001)])
    expect(() => parsePageOrder(value, 3)).toThrow();
  for (const count of [0, -1, 1.5, NaN, 10001]) expect(() => parsePageOrder("1", count)).toThrow(/10000/);
});
it("generates reverse, parity and front/back interleaving for even, odd and unequal block sizes", () => {
  expect(pageOrderPreset(6, "reverse")).toEqual([5,4,3,2,1,0]);
  expect(pageOrderPreset(5, "oddEven")).toEqual([0,2,4,1,3]); expect(pageOrderPreset(5, "evenOdd")).toEqual([1,3,0,2,4]);
  expect(pageOrderPreset(6, "interleave")).toEqual([0,5,1,4,2,3]);
  expect(pageOrderPreset(5, "interleave")).toEqual([0,4,1,3,2]);
  expect(pageOrderPreset(6, "interleave", 3, false)).toEqual([0,3,1,4,2,5]);
  expect(pageOrderPreset(5, "interleave", 1, true)).toEqual([0,4,3,2,1]);
  expect(pageOrderPreset(5, "interleave", 4, false)).toEqual([0,4,1,2,3]);
  for (const split of [0,6,-1,1.5,NaN]) expect(() => pageOrderPreset(6, "interleave", split)).toThrow(/前半/);
  expect(() => pageOrderPreset(1, "interleave")).toThrow();
  for (let count = 1; count <= 100; count++) for (const mode of ["reverse", "oddEven", "evenOdd", ...(count > 1 ? ["interleave"] : [])] as const) {
    const order = pageOrderPreset(count, mode as Parameters<typeof pageOrderPreset>[1]);
    expect([...order].sort((a,b) => a-b)).toEqual(Array.from({ length: count }, (_, i) => i));
  }
});
it("reorders pages atomically without mutating their identities or other references, supports undo and suppresses no-ops", () => {
  const d = emptyDocument(); d.pages = [blankPage(), blankPage(), blankPage()]; d.pages[1].label = "ii";
  d.bookmarks = [{ id: "b", title: "Target", pageId: d.pages[1].id, children: [] }];
  const h = new History(d), input = [2,0,1], command = reorderAllPages(d, input); input.reverse(); h.execute(command);
  const changed = h.current; expect(changed.document.pages).toEqual([d.pages[2],d.pages[0],d.pages[1]]);
  expect(changed.document.pages[2]).toBe(d.pages[1]); expect(changed.document.bookmarks).toBe(d.bookmarks); expect(d.pages[1].label).toBe("ii");
  h.undo(); expect(h.current.document).toBe(d); h.redo(); expect(h.current).toBe(changed);
  const noOp = new History(d); noOp.execute(reorderAllPages(d, [0,1,2])); expect(noOp.canUndo).toBe(false);
  for (const order of [[0], [0,1,1], [0,1,3], [0,1,NaN], [0,1,1.5]]) expect(() => reorderAllPages(d, order)).toThrow();
  expect(() => reorderAllPages(d, [2,1,0]).apply({ ...d })).toThrow(/変更/);
  expect(() => reorderAllPages({ ...d, pages: [d.pages[0], d.pages[0]] }, [1,0])).toThrow();
});
it("preserves labels, bookmark/link destinations, widgets and edits through project and PDF saves", async () => {
  const pdf = await PDFDocument.create(); const pages = Array.from({ length: 6 }, (_, i) => pdf.addPage([300 + i, 400]));
  const field = pdf.getForm().createTextField("Name"); field.addToPage(pages[4], { x: 20, y: 30, width: 150, height: 20 }); field.setText("Kept");
  const d = emptyDocument(); d.sources.s = { id: "s", name: "order.pdf", bytes: await pdf.save() };
  d.pages = pages.map((_, i) => ({ ...blankPage(), sourceId: "s", sourceIndex: i, width: 300+i, height: 400, label: `P${i+1}` }));
  d.pages[0].objects = [{ ...newObject("link", 20, 60), link: { kind: "page", pageId: d.pages[4].id } }];
  d.bookmarks = [{ id: "b", title: "Target", pageId: d.pages[4].id, destination: { kind: "FitH", top: 300 }, children: [] }];
  const ordered = reorderAllPages(d, pageOrderPreset(6, "interleave")).apply(d), restored = await openProject(await saveProject(ordered));
  expect(restored.pages.map(p => p.id)).toEqual(ordered.pages.map(p => p.id));
  const bytes = await exportPdf(restored), output = await PDFDocument.load(bytes), n = PDFName.of;
  expect(output.getPages().map(p => p.getWidth())).toEqual([300,305,301,304,302,303]);
  const destination = output.catalog.lookup(n("Outlines"), PDFDict).lookup(n("First"), PDFDict).lookup(n("Dest"), PDFArray);
  expect(destination.get(0)).toBe(output.getPage(3).ref); expect(destination.get(1)).toBe(n("FitH")); expect(destination.lookup(2, PDFNumber).asNumber()).toBe(300);
  const link = output.getPage(0).node.Annots()!.lookup(0, PDFDict).lookup(n("Dest"), PDFArray); expect(link.get(0)).toBe(output.getPage(3).ref);
  expect(output.getForm().getTextField("Name").acroField.getWidgets()[0].P()).toBe(output.getPage(3).ref);
  expect(output.getForm().getTextField("Name").getText()).toBe("Kept");
  const loading = getDocument({ data: bytes.slice() }); const parsed = await loading.promise;
  expect(await parsed.getPageLabels()).toEqual(["P1","P6","P2","P5","P3","P4"]); await loading.destroy();
});
