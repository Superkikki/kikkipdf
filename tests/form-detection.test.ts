import { expect, it } from "vitest";
import { detectFormRectangles, addDetectedFields } from "../src/forms/detection";
import { blankPage, emptyDocument } from "../src/state/model";
import { History } from "../src/commands/history";
import { saveProject, openProject } from "../src/state/project";
import { exportPdf, inspectForms } from "../src/export/engine";
function image() {
  const width = 400, height = 300, data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x: number, y: number) => { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; };
  const rect = (x: number, y: number, w: number, h: number) => { for (let i = x; i <= x + w; i++) { ink(i, y); ink(i, y + h); } for (let j = y; j <= y + h; j++) { ink(x, j); ink(x + w, j); } };
  rect(20, 30, 180, 25); rect(20, 90, 18, 18); rect(20, 130, 180, 25);
  for (let y = 135; y < 150; y++) for (let x = 30; x < 100; x++) ink(x, y); // Filled field must not be suggested.
  return { data, width, height };
}
it("detects empty text and checkbox frames while rejecting filled fields", () => {
  const { data, width, height } = image(); const found = detectFormRectangles(data, width, height, width, height);
  expect(found).toHaveLength(2); expect(found[0]).toMatchObject({ x: 20, y: 30, width: 180, height: 25, kind: "text" }); expect(found[1].kind).toBe("checkbox");
});
it("normalizes pixel coordinates and rejects invalid buffers", () => {
  const { data, width, height } = image(); expect(detectFormRectangles(data, width, height, width * 2, height * 2)[0].x).toBe(40);
  expect(() => detectFormRectangles(data, 1, 1, 100, 100)).toThrow("サイズ");
});
it("adds editable unique fields atomically, supports undo and survives PDF/project saves", async () => {
  const model = emptyDocument(); model.pages = [{ ...blankPage(), width: 400, height: 300 }]; const pageId = model.pages[0].id;
  const { data, width, height } = image(), candidates = detectFormRectangles(data, width, height, width, height).map(c => ({ ...c, name: "Input" }));
  const history = new History(model); history.execute(addDetectedFields(model, pageId, candidates, []));
  expect(history.current.document.formFields!.map(f => f.name)).toEqual(["Input", "Input_2"]);
  const restored = await openProject(await saveProject(history.current.document)); expect(restored.formFields).toEqual(history.current.document.formFields);
  const bytes = await exportPdf(restored); expect((await inspectForms({ sources: { s: { id: "s", name: "detected.pdf", bytes } } })).map(f => f.kind)).toEqual(["text", "checkbox"]);
  history.undo(); expect(history.current.document).toBe(model); history.redo(); expect(history.current.document.formFields).toHaveLength(2);
});
it("rejects stale documents, overlap and invalid names without partial additions", () => {
  const model = emptyDocument(); model.pages = [blankPage()]; const candidate = { x: 20, y: 20, width: 100, height: 25, kind: "text" as const, name: "Input" }, pageId = model.pages[0].id;
  expect(() => addDetectedFields(model, pageId, [candidate], []).apply({ ...model })).toThrow("文書が変更");
  expect(() => addDetectedFields(model, pageId, [candidate, candidate], []).apply(model)).toThrow("重なって");
  expect(() => addDetectedFields(model, pageId, [{ ...candidate, name: " " }], []).apply(model)).toThrow("名前");
  expect(model.formFields).toBeUndefined();
});
it("detects lighter scan borders after image resampling", () => {
  const { data, width, height } = image(); for (let i = 0; i < data.length; i += 4) if (data[i] === 0) data[i] = data[i + 1] = data[i + 2] = 180;
  expect(detectFormRectangles(data, width, height, width, height)).toHaveLength(2);
});
