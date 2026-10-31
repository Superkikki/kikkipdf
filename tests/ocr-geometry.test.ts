import { expect, it } from "vitest";
import { blankPage, emptyDocument, newObject } from "../src/state/model";
import { recognitionGeometry, recognizedBoxes, recognizedMatch } from "../src/ocr/geometry";
import { patchObject } from "../src/commands/objects";
import { openProject, saveProject } from "../src/state/project";

const bbox = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const geometry = recognitionGeometry({ text: "W i中\n", bbox: bbox(100, 50, 300, 70), words: [
  { text: "W", bbox: bbox(100, 50, 140, 70), symbols: [{ text: "W", bbox: bbox(100, 50, 140, 70) }] },
  { text: "i中", bbox: bbox(250, 50, 300, 70), symbols: [
    { text: "i", bbox: bbox(250, 55, 254, 70) }, { text: "中", bbox: bbox(280, 50, 300, 70) },
  ] },
] })!;
const object = { ...newObject("ocr", 50, 80), text: geometry.text, width: 200, height: 20, ocrGeometry: geometry };

it("retains original glyph positions and word gaps without replacement-font estimates", () => {
  expect(geometry.text).toBe("W i中");
  expect(recognizedMatch(object, 2, 3)).toEqual({ x: 200, y: 85, width: 4, height: 15 });
  expect(recognizedMatch(object, 2, 4)).toEqual({ x: 200, y: 80, width: 50, height: 20 });
  expect(recognizedMatch(object, 1, 2)).toBeUndefined();
});

it("scales recognition boxes with line movement and resizing, then drops stale geometry after correction", () => {
  const moved = patchObject(object, { x: 80, y: 100, width: 400, height: 40 });
  expect(recognizedMatch(moved, 2, 3)).toEqual({ x: 380, y: 110, width: 8, height: 30 });
  expect(patchObject(object, { text: "W i中" }).ocrGeometry).toEqual(geometry);
  expect(patchObject(object, { text: "corrected" }).ocrGeometry).toBeUndefined();
  expect(recognizedBoxes({ ...object, text: "stale" })).toEqual([]);
});

it("preserves geometry in saved projects", async () => {
  const model = emptyDocument(); model.pages = [blankPage()]; model.pages[0].objects = [object];
  const restored = await openProject(await saveProject(model));
  expect(restored.pages[0].objects[0].ocrGeometry).toEqual(geometry);
});

it("refuses to attach glyph positions when recognition text cannot be mapped", () => {
  expect(recognitionGeometry({ text: "wrong", bbox: bbox(0, 0, 50, 20),
    words: [{ text: "different", bbox: bbox(0, 0, 50, 20) }] })).toBeUndefined();
});
