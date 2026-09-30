import { expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import {
  selectionBox,
  selectedTextMarkup,
  mergeTextFragments,
} from "../src/annotations/textSelection";
import { blankPage, emptyDocument } from "../src/state/model";
import { exportPdf } from "../src/export/engine";
import { History } from "../src/commands/history";

it("maps screen selections through every page rotation and zoom, including crop offsets", () => {
  const page = { ...blankPage(), width: 100, height: 200 };
  expect(
    selectionBox(
      page,
      { x: 50, y: 70, width: 200, height: 400 },
      { x: 90, y: 130, width: 40, height: 20 },
    ),
  ).toEqual({ x: 20, y: 30, width: 20, height: 10 });
  for (const [rotation, rectangle] of [
    [90, { x: 370, y: 110, width: 20, height: 40 }],
    [180, { x: 170, y: 390, width: 40, height: 20 }],
    [270, { x: 110, y: 190, width: 20, height: 40 }],
  ] as const) {
    expect(
      selectionBox(
        { ...page, rotation },
        {
          x: 50,
          y: 70,
          width: rotation === 180 ? 200 : 400,
          height: rotation === 180 ? 400 : 200,
        },
        rectangle,
      ),
    ).toEqual({ x: 20, y: 30, width: 20, height: 10 });
  }
  page.crop = { x: 25, y: 30, width: 50, height: 100 };
  expect(
    selectionBox(
      page,
      { x: 0, y: 0, width: 100, height: 200 },
      { x: 20, y: 20, width: 20, height: 20 },
    ),
  ).toEqual({ x: 25, y: 30, width: 15, height: 10 });
  expect(
    selectionBox(
      page,
      { x: 0, y: 0, width: 100, height: 200 },
      { x: 0, y: 0, width: 10, height: 10 },
    ),
  ).toBeUndefined();
});

it("merges adjacent fragments without joining lines or changing the original selection", () => {
  const fragments = [
    { x: 10, y: 20, width: 30, height: 12, text: "hello " },
    { x: 40, y: 20, width: 30, height: 12, text: "world" },
    { x: 10, y: 40, width: 30, height: 12, text: "next" },
  ];
  expect(mergeTextFragments(fragments)).toEqual([
    { x: 10, y: 20, width: 60, height: 12, text: "hello world" },
    fragments[2],
  ]);
  expect(fragments[0].width).toBe(30);
});

it("adds multi-page markup as one undoable command and writes actual PDF annotations", async () => {
  const model = emptyDocument();
  model.pages = [blankPage(), blankPage()];
  const selected = model.pages.map((page, i) => ({
    pageId: page.id,
    fragments: [{ x: 20, y: 30, width: 80, height: 12, text: `selected ${i}` }],
  }));
  for (const [kind, subtype] of [
    ["highlight", "Highlight"],
    ["underline", "Underline"],
    ["strike", "StrikeOut"],
  ] as const) {
    const history = new History(model);
    history.execute(selectedTextMarkup(selected, kind).command);
    expect(
      history.current.document.pages.every((p) => p.objects.length === 1),
    ).toBe(true);
    history.undo();
    expect(
      history.current.document.pages.every((p) => p.objects.length === 0),
    ).toBe(true);
    history.redo();
    const pdf = await PDFDocument.load(
      await exportPdf(history.current.document),
    );
    for (let i = 0; i < 2; i++) {
      const annotation = pdf.getPage(i).node.Annots()!.lookup(0, PDFDict);
      expect(annotation.get(PDFName.of("Subtype"))).toBe(PDFName.of(subtype));
      expect(
        annotation.lookup(PDFName.of("Contents"), PDFHexString).decodeText(),
      ).toBe(`selected ${i}`);
      expect(
        annotation
          .lookup(PDFName.of("QuadPoints"), PDFArray)
          .asArray()
          .map((v) => Number(v.toString())),
      ).toEqual([
        20,
        model.pages[i].height - 30,
        100,
        model.pages[i].height - 30,
        20,
        model.pages[i].height - 42,
        100,
        model.pages[i].height - 42,
      ]);
      expect(annotation.has(PDFName.of("AP"))).toBe(true);
    }
  }
});
