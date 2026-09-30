import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFArray } from "pdf-lib";
import { readFile } from "node:fs/promises";
import {
  emptyDocument,
  blankPage,
  type FormFieldModel,
} from "../src/state/model";
import { exportPdf, inspectForms } from "../src/export/engine";
import {
  duplicatePage,
  deletePages,
  mergeDocuments,
} from "../src/commands/document";
async function fixture(id = "source") {
  const input = await PDFDocument.create(),
    a = input.addPage(),
    b = input.addPage();
  const form = input.getForm();
  const text = form.createTextField("Customer.Name");
  text.addToPage(a, { x: 30, y: 600, width: 200, height: 30 });
  text.addToPage(b, { x: 30, y: 500, width: 200, height: 30 });
  text.setText("Before");
  const radio = form.createRadioGroup("Choice");
  radio.addOptionToPage("A", a);
  radio.addOptionToPage("B", b);
  radio.select("B");
  const dropdown = form.createDropdown("Color");
  dropdown.setOptions(["Red", "Green"]);
  dropdown.addToPage(a);
  dropdown.select("Red");
  const model = emptyDocument();
  model.sources[id] = { id, name: id + ".pdf", bytes: await input.save() };
  model.pages = [a, b].map((_, i) => ({
    ...blankPage(),
    sourceId: id,
    sourceIndex: i,
  }));
  return model;
}
describe("interactive AcroForm export", () => {
  it("retains multiline limits and multiple selections through imported and created fields", async () => {
    const input = await PDFDocument.create(),
      page = input.addPage(),
      form = input.getForm();
    const text = form.createTextField("Notes");
    text.enableMultiline();
    text.setMaxLength(20);
    text.setText("Line 1\nLine 2");
    text.addToPage(page);
    const list = form.createOptionList("Categories");
    list.setOptions(["A", "B", "C"]);
    list.enableMultiselect();
    list.select(["A", "C"]);
    list.addToPage(page);
    const model = emptyDocument();
    model.sources.s = { id: "s", name: "form.pdf", bytes: await input.save() };
    model.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0 }];
    const descriptors = await inspectForms(model);
    expect(descriptors.find((f) => f.name === "Notes")).toMatchObject({
      multiline: true,
      maxLength: 20,
    });
    expect(descriptors.find((f) => f.name === "Categories")).toMatchObject({
      multiSelect: true,
      value: ["A", "C"],
    });
    model.formValues["s:Categories"] = ["B", "C"];
    model.formFields = [
      {
        id: "new",
        pageId: model.pages[0].id,
        name: "NewList",
        kind: "list",
        value: ["A", "C"],
        options: ["A", "B", "C"],
        x: 10,
        y: 30,
        width: 100,
        height: 70,
        fontSize: 12,
        readOnly: false,
        required: false,
        multiline: false,
        multiSelect: true,
      },
    ];
    const exported = await PDFDocument.load(await exportPdf(model));
    expect(
      exported.getForm().getOptionList("Categories").getSelected(),
    ).toEqual(["B", "C"]);
    expect(exported.getForm().getOptionList("NewList").getSelected()).toEqual([
      "A",
      "C",
    ]);
    expect(exported.getForm().getTextField("Notes").getMaxLength()).toBe(20);
    expect(exported.getForm().getTextField("Notes").isMultiline()).toBe(true);
  });
  it("keeps shared fields linked only to retained/duplicated pages", async () => {
    let model = await fixture();
    model = duplicatePage(model.pages[0].id).apply(model);
    model = deletePages([model.pages[2].id]).apply(model);
    model.formValues["source:Customer.Name"] = "Changed";
    const pdf = await PDFDocument.load(await exportPdf(model));
    const field = pdf.getForm().getTextField("Customer.Name");
    expect(field.getText()).toBe("Changed");
    expect(field.acroField.getWidgets()).toHaveLength(2);
    const refs = pdf.getPages().map((p) => p.ref.toString());
    for (const w of field.acroField.getWidgets())
      expect(refs).toContain(w.P()?.toString());
    for (const page of pdf.getPages()) {
      const annots = page.node.lookup(PDFName.of("Annots"), PDFArray);
      for (let i = 0; i < annots.size(); i++)
        expect(annots.lookup(i, PDFDict).get(PDFName.of("P"))).toEqual(
          page.ref,
        );
    }
    // A second edit in another pdf-lib instance must remain possible.
    field.setText("Edited again");
    const reopened = await PDFDocument.load(await pdf.save());
    expect(reopened.getForm().getTextField("Customer.Name").getText()).toBe(
      "Edited again",
    );
  });
  it("namespaces colliding forms and preserves cleared choices", async () => {
    const model = mergeDocuments(await fixture("second")).apply(
      await fixture(),
    );
    model.formValues["source:Color"] = "";
    model.formValues["source:Choice"] = "";
    const pdf = await PDFDocument.load(await exportPdf(model));
    expect(pdf.getForm().getFields()).toHaveLength(6);
    expect(pdf.getForm().getTextField("Customer.Name_2").getText()).toBe(
      "Before",
    );
    expect(pdf.getForm().getDropdown("Color").getSelected()).toEqual([]);
    expect(pdf.getForm().getRadioGroup("Choice").getSelected()).toBeUndefined();
  });
  it("embeds an editable Japanese form font and creates all supported field types", async () => {
    const model = emptyDocument();
    model.pages = [blankPage()];
    model.formFields = ["text", "checkbox", "radio", "dropdown", "list"].map(
      (kind, i) => ({
        id: kind,
        pageId: model.pages[0].id,
        name: kind,
        kind: kind as FormFieldModel["kind"],
        x: 30,
        y: 40 + i * 100,
        width: 200,
        height: 60,
        value:
          kind === "checkbox" ? true : kind === "text" ? "入力済み" : "選択肢2",
        options: ["選択肢1", "選択肢2"],
        fontSize: 12,
        required: true,
        readOnly: false,
        multiline: kind === "text",
      }),
    );
    const font = new Uint8Array(
      await readFile("public/assets/NotoSansJP-Regular.otf"),
    );
    const bytes = await exportPdf(model, font),
      pdf = await PDFDocument.load(bytes);
    expect(pdf.getForm().getFields()).toHaveLength(5);
    expect(pdf.getForm().getTextField("text").getText()).toBe("入力済み");
    expect(pdf.getForm().getTextField("text").isMultiline()).toBe(true);
    expect(pdf.getForm().getCheckBox("checkbox").isChecked()).toBe(true);
    expect(pdf.getForm().getRadioGroup("radio").getSelected()).toBe("選択肢2");
    const resources = pdf
      .getForm()
      .acroForm.dict.lookup(PDFName.of("DR"), PDFDict);
    const fontDict = resources
      .lookup(PDFName.of("Font"), PDFDict)
      .lookup(PDFName.of("KikkiForm"), PDFDict);
    expect(fontDict.get(PDFName.of("Subtype"))?.toString()).toBe("/Type0");
    // Explicit flatten mode is still available, with all values drawn into pages.
    model.flattenForms = true;
    const flat = await PDFDocument.load(await exportPdf(model, font));
    expect(flat.getForm().getFields()).toHaveLength(0);
  });
});
