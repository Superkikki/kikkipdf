import { expect, it } from "vitest";
import { blankPage, emptyDocument } from "../src/state/model";
import { planBates, addBatesNumbers, batesObject, type BatesOptions } from "../src/pages/bates";
import { History } from "../src/commands/history";
import { saveProject, openProject } from "../src/state/project";
const settings: BatesOptions = { range: "3,1", prefix: "CASE-", suffix: "-A", start: 7, digits: 3, position: "bottom-right", margin: 24, fontSize: 11, color: "#123456" };
function fixture() { const doc = emptyDocument(); doc.pages = Array.from({ length: 4 }, (_, i) => ({ ...blankPage(), width: 300, height: 400, rotation: i * 90, crop: { x: 10, y: 20, width: 250, height: 350 } })); return doc; }
it("numbers only selected pages in document order and checks overflow", () => {
  const d = fixture(); expect(planBates(d, settings).map(p => [p.pageIndex, p.text])).toEqual([[0,"CASE-007-A"],[2,"CASE-008-A"]]);
  expect(() => planBates(d, { ...settings, start: 999, digits: 3 })).toThrow("桁数");
  expect(() => planBates(d, { ...settings, range: "1-5" })).toThrow("範囲");
  expect(() => planBates(d, { ...settings, start: NaN })).toThrow("開始番号");
  expect(() => planBates(d, { ...settings, prefix: "x\ny" })).toThrow("1行");
  expect(planBates(d, { ...settings, prefix: "案件-" })[0].text).toBe("案件-007-A");
  expect(batesObject(d.pages[0], "案件-007", settings).font).toBe("japanese");
  expect(() => planBates(d, { ...settings, margin: 144 })).toThrow("小さすぎ");
});
it("places the rotated text box at the same visible edge on all four page orientations", () => {
  const d = fixture();
  for (const page of d.pages) for (const position of ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const) {
    const opts = { ...settings, position }, o = batesObject(page, "CASE-007-A", opts), c = page.crop!, u = o.x - c.x, v = o.y + o.height - c.y;
    const point = page.rotation === 0 ? [u,v] : page.rotation === 90 ? [c.height-v,u] : page.rotation === 180 ? [c.width-u,c.height-v] : [v,c.width-u];
    const visibleHeight = page.rotation % 180 ? c.width : c.height;
    expect(point[0]).toBe(24); expect(point[1]).toBe(position.startsWith("top") ? 24 + o.height : visibleHeight - 24);
    expect(o.rotation + page.rotation).toBe(0); expect(o.align).toBe(position.split("-")[1]);
  }
});
it("adds all numbers atomically, supports undo and persists in projects", async () => {
  const d=fixture(), h=new History(d); h.execute(addBatesNumbers(d, settings));
  expect(h.current.document.pages.map(p => p.objects.map(o => o.text))).toEqual([["CASE-007-A"],[],["CASE-008-A"],[]]);
  const restored=await openProject(await saveProject(h.current.document)); expect(restored.pages[2].objects[0].text).toBe("CASE-008-A");
  h.undo(); expect(h.current.document).toBe(d); h.redo(); expect(h.current.document.pages[0].objects).toHaveLength(1);
  expect(() => addBatesNumbers(d, settings).apply({ ...d })).toThrow("文書が変更");
});
