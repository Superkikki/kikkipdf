import { expect, it } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFRawStream,
  degrees,
} from "pdf-lib";
import { blankPage, emptyDocument } from "../src/state/model";
import { exportPdf, inspectForms } from "../src/export/engine";
import { updateFormWidget, resetFormWidget } from "../src/forms/commands";
import {
  duplicatePage,
  reorderPage,
  deletePages,
} from "../src/commands/document";
import { History } from "../src/commands/history";
import { openProject, saveProject } from "../src/state/project";

async function fixture() {
  const input = await PDFDocument.create(),
    first = input.addPage([500, 600]),
    second = input.addPage([500, 600]);
  first.setCropBox(50, 80, 400, 500);
  first.setRotation(degrees(90));
  const form = input.getForm(),
    text = form.createTextField("Shared.Name");
  text.addToPage(first, { x: 80, y: 420, width: 160, height: 30 });
  text.addToPage(second, { x: 40, y: 360, width: 160, height: 30 });
  text.setText("Original");
  const check = form.createCheckBox("Consent");
  check.addToPage(first, { x: 300, y: 410, width: 20, height: 20 });
  check.check();
  const radio = form.createRadioGroup("Choice");
  radio.addOptionToPage("A", first, { x: 300, y: 340 });
  radio.addOptionToPage("B", second, { x: 300, y: 340 });
  radio.select("B");
  const dropdown = form.createDropdown("Color");
  dropdown.setOptions(["Red", "Green"]);
  dropdown.select("Green");
  dropdown.addToPage(first, { x: 80, y: 300, width: 160, height: 30 });
  const list = form.createOptionList("Tags");
  list.setOptions(["One", "Two"]);
  list.select("Two");
  list.addToPage(first, { x: 80, y: 180, width: 160, height: 80 });
  const model = emptyDocument();
  model.sources.s = { id: "s", name: "layout.pdf", bytes: await input.save() };
  model.pages = [
    { ...blankPage(), sourceId: "s", width: 400, height: 500, rotation: 90 },
    { ...blankPage(), sourceId: "s", sourceIndex: 1, width: 500, height: 600 },
  ];
  return model;
}

it("inspects widget identities and positions relative to the original crop, independently of rotation", async () => {
  const fields = await inspectForms(await fixture()),
    text = fields.find((f) => f.name === "Shared.Name")!;
  expect(text.sourceId).toBe("s");
  expect(text.widgets).toHaveLength(2);
  expect(text.widgets[0]).toMatchObject({
    pageIndex: 0,
    x: 29.5,
    y: 129.5,
    width: 161,
    height: 31,
  });
  expect(text.widgets[1].pageIndex).toBe(1);
  expect(
    fields.find((f) => f.kind === "radio")!.widgets.map((w) => w.option),
  ).toEqual(["A", "B"]);
});

it("moves and resizes every supported widget while preserving values and rebuilding appearance dimensions", async () => {
  let model = await fixture();
  const fields = await inspectForms(model);
  const box = { x: 60, y: 100, width: 190, height: 45 };
  for (const field of fields)
    for (const widget of field.widgets.filter((w) => w.pageIndex === 0))
      model = updateFormWidget(model.pages[0].id, widget.id, box).apply(model);
  model.formValues["s:Shared.Name"] = "Changed";
  const output = await PDFDocument.load(await exportPdf(model));
  for (const field of output.getForm().getFields())
    for (const widget of field.acroField
      .getWidgets()
      .filter((w) => w.P() === output.getPage(0).ref)) {
      expect(widget.getRectangle()).toEqual({
        x: 110,
        y: 435,
        width: 190,
        height: 45,
      });
      const ap = widget.dict.lookup(PDFName.of("AP"), PDFDict),
        normal = ap.lookup(PDFName.of("N"));
      const streams =
        normal instanceof PDFDict
          ? normal.entries().map(([, v]) => output.context.lookup(v))
          : [normal];
      for (const stream of streams) {
        expect(stream).toBeInstanceOf(PDFRawStream);
        const bbox = (stream as PDFRawStream).dict
          .lookup(PDFName.of("BBox"), PDFArray)
          .asArray()
          .map((v) => Number(v.toString()));
        expect(bbox).toEqual([0, 0, 190, 45]);
      }
    }
  expect(output.getForm().getTextField("Shared.Name").getText()).toBe(
    "Changed",
  );
  expect(output.getForm().getCheckBox("Consent").isChecked()).toBe(true);
  expect(output.getForm().getDropdown("Color").getSelected()).toEqual([
    "Green",
  ]);
  expect(output.getForm().getOptionList("Tags").getSelected()).toEqual(["Two"]);
  const originalSecond = (await inspectForms(await fixture())).find(
    (f) => f.kind === "text",
  )!.widgets[1];
  expect(
    output
      .getForm()
      .getTextField("Shared.Name")
      .acroField.getWidgets()[1]
      .getRectangle().width,
  ).toBe(originalSecond.width);
  output.getForm().getTextField("Shared.Name").setText("Again");
  expect(
    (await PDFDocument.load(await output.save()))
      .getForm()
      .getTextField("Shared.Name")
      .getText(),
  ).toBe("Again");
});

it("keeps page-copy layouts independent through undo, reset, redo, project restoration, reordering and extraction", async () => {
  const model = await fixture(),
    descriptor = (await inspectForms(model)).find((f) => f.kind === "text")!
      .widgets[0];
  const history = new History(model),
    box = { x: 70, y: 90, width: 180, height: 40 };
  history.execute(duplicatePage(model.pages[0].id));
  const copy = history.current.document.pages[1];
  history.execute(updateFormWidget(copy.id, descriptor.id, box));
  expect(history.current.document.pages[0].formWidgetEdits).toBeUndefined();
  history.undo();
  expect(history.current.document.pages[1].formWidgetEdits).toBeUndefined();
  history.redo();
  history.execute(resetFormWidget(copy.id, descriptor.id));
  expect(
    history.current.document.pages[1].formWidgetEdits?.[descriptor.id],
  ).toBeUndefined();
  history.undo();
  let restored = await openProject(await saveProject(history.current.document));
  expect(restored.pages[1].formWidgetEdits?.[descriptor.id]).toEqual(box);
  restored = reorderPage(copy.id, restored.pages[0].id).apply(restored);
  const pdf = await PDFDocument.load(
    await exportPdf(restored, undefined, { indices: [0] }),
  );
  expect(pdf.getPageCount()).toBe(1);
  expect(
    pdf.getForm().getTextField("Shared.Name").acroField.getWidgets(),
  ).toHaveLength(1);
  expect(
    pdf
      .getForm()
      .getTextField("Shared.Name")
      .acroField.getWidgets()[0]
      .getRectangle(),
  ).toEqual({ x: 120, y: 450, width: 180, height: 40 });
});

it("flattens at the edited placement and retains correct radio export options after page deletion", async () => {
  let model = await fixture();
  const fields = await inspectForms(model);
  model = deletePages([model.pages[0].id]).apply(model);
  const radio = (await PDFDocument.load(await exportPdf(model)))
    .getForm()
    .getRadioGroup("Choice");
  expect(radio.getOptions()).toEqual(["B"]);
  expect(radio.getSelected()).toBe("B");
  radio.select("B");
  const widget = fields.find((f) => f.kind === "text")!.widgets[1];
  model = updateFormWidget(model.pages[0].id, widget.id, {
    x: 200,
    y: 100,
    width: 120,
    height: 40,
  }).apply(model);
  model.flattenForms = true;
  const flattened = await PDFDocument.load(await exportPdf(model));
  expect(flattened.getForm().getFields()).toHaveLength(0);
  expect(flattened.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  const resources = flattened
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of("XObject"), PDFDict);
  expect(resources.keys().length).toBeGreaterThan(0);
});

it("rejects invalid geometry before it enters history or a project", async () => {
  expect(() =>
    updateFormWidget("p", "w", { x: NaN, y: 0, width: 100, height: 20 }),
  ).toThrow();
  expect(() =>
    updateFormWidget("p", "w", { x: 0, y: 0, width: -1, height: 20 }),
  ).toThrow();
  const model = await fixture();
  model.pages[0].formWidgetEdits = { w: { x: 0, y: 0, width: 0, height: 1 } };
  await expect(saveProject(model)).rejects.toThrow();
});
