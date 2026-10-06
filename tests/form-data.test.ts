import { expect, it } from "vitest";
import { PDFDocument, PDFName, PDFHexString, PDFDict } from "pdf-lib";
import { blankPage, emptyDocument } from "../src/state/model";
import { inspectForms, exportPdf } from "../src/export/engine";
import { applyFormData, dataFields, restoreFormData } from "../src/forms/data";
import { formDataXfdf } from "../src/forms/xfdf";
import { updateImportedForm } from "../src/forms/commands";
import { History } from "../src/commands/history";
import { openProject, saveProject } from "../src/state/project";

async function fixture() {
  const pdf = await PDFDocument.create(), page = pdf.addPage(), other = pdf.addPage(), form = pdf.getForm();
  const text = form.createTextField("Customer.Name"); text.setText("Before"); text.enableMultiline(); text.setMaxLength(12); text.addToPage(page);
  const check = form.createCheckBox("Agree"); check.addToPage(page);
  const radio = form.createRadioGroup("Choice"); radio.addOptionToPage("A", page); radio.addOptionToPage("B", page); radio.select("B");
  const dropdown = form.createDropdown("Color"); dropdown.setOptions(["Red", "Green"]); dropdown.addToPage(page);
  dropdown.acroField.setOptions([{ value: PDFHexString.fromText("R"), display: PDFHexString.fromText("Red") }, { value: PDFHexString.fromText("G"), display: PDFHexString.fromText("Green") }]);
  dropdown.select("R");
  const list = form.createOptionList("Tags"); list.setOptions(["One", "Two", "Three"]); list.enableMultiselect(); list.addToPage(page); list.select(["One", "Three"]);
  const hidden = form.createTextField("Removed"); hidden.addToPage(other);
  const model = emptyDocument(); model.sources.s = { id: "s", name: "data.pdf", bytes: await pdf.save() };
  model.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0 }];
  model.formFields = [{ id: "new", pageId: model.pages[0].id, name: "Added", kind: "text", value: "New", x: 20, y: 20, width: 100, height: 30, options: [], fontSize: 12, readOnly: false, required: false, multiline: false }];
  return { model, fields: await inspectForms(model) };
}
it("imports all five kinds and created fields atomically, with history and project/PDF round trips", async () => {
  const { model, fields } = await fixture(); const original = model.sources.s.bytes.slice(); const history = new History(model);
  history.execute(applyFormData(fields, [
    { name: "Customer.Name", values: ["After <&>"] }, { name: "Agree", values: ["Yes"] },
    { name: "Choice", values: ["A"] }, { name: "Color", values: ["G"] }, { name: "Tags", values: ["Two"] }, { name: "Added", values: ["Changed"] },
  ]));
  const edited = history.current.document; expect(edited.formFields![0].value).toBe("Changed");
  history.undo(); expect(history.current.document).toBe(model); history.redo(); expect(history.current.document).toBe(edited);
  expect(edited.sources.s.bytes).toEqual(original);
  const restored = await openProject(await saveProject(edited)); expect(restored.formValues).toEqual(edited.formValues);
  const pdf = await PDFDocument.load(await exportPdf(restored)), form = pdf.getForm();
  expect(form.getTextField("Customer.Name").getText()).toBe("After <&>"); expect(form.getCheckBox("Agree").isChecked()).toBe(true);
  expect(form.getRadioGroup("Choice").getSelected()).toBe("A"); expect(form.getDropdown("Color").getSelected()).toEqual(["G"]);
  expect(form.getOptionList("Tags").getSelected()).toEqual(["Two"]); expect(form.getTextField("Added").getText()).toBe("Changed");
});
it("rejects missing/duplicate names, readonly changes and invalid values before applying anything", async () => {
  const { model, fields } = await fixture(); const history = new History(model);
  const good = { name: "Customer.Name", values: ["Good"] };
  for (const bad of [ { name: "Removed", values: ["x"] }, { name: "Missing", values: ["x"] },
    { name: "Agree", values: ["true"] }, { name: "Choice", values: ["X"] }, { name: "Color", values: ["Green"] },
    { name: "Tags", values: ["Two", "Two"] }, { name: "Tags", values: [""] }, { name: "Customer.Name", values: ["too long for limit"] }, good ]) {
    expect(() => history.execute(applyFormData(fields, [good, bad]))).toThrow();
    expect(history.current.document).toBe(model); expect(history.dirty).toBe(false); expect(history.canUndo).toBe(false);
  }
  const readonly = updateImportedForm(fields.find(f => f.name === "Color")!, { readOnly: true }).apply(model);
  expect(applyFormData(fields, [{ name: "Color", values: ["R"] }]).apply(readonly)).toBe(readonly);
  expect(() => applyFormData(fields, [{ name: "Color", values: ["G"] }]).apply(readonly)).toThrow(/読み取り専用/);
  const duplicate = { ...model, formFields: [{ ...model.formFields![0], name: "Agree" }] };
  expect(() => applyFormData(fields, [{ name: "Agree", values: ["Yes"] }]).apply(duplicate)).toThrow(/重複/);
});
it("exports only present fields, escaped text and export values without changing history", async () => {
  const { model, fields } = await fixture(); model.formValues["s:Customer.Name"] = 'Line 1\r\n<&>"';
  const history = new History(model); const xml = new TextDecoder().decode(formDataXfdf(dataFields(model, fields)));
  expect(xml).toContain('name="Customer.Name"><value>Line 1&#13;&#10;&lt;&amp;&gt;&quot;</value>');
  expect(xml).toContain('name="Color"><value>R</value>'); expect(xml).toContain('<value>Off</value>'); expect(xml).not.toContain('name="Removed"');
  expect(history.dirty).toBe(false); expect(history.canUndo).toBe(false);
  model.formValues["s:Customer.Name"] = '\u0000'; expect(() => formDataXfdf(dataFields(model, fields))).toThrow(/XML/);
});
it("restores original selection by index after renaming radio values and keeps settings/layout", async () => {
  const { model, fields } = await fixture(); const radio = fields.find(f => f.kind === "radio")!;
  let edited = updateImportedForm(radio, { options: ["First", "Second"] }).apply(model);
  edited = applyFormData(fields, [{ name: "Choice", values: ["First"] }, { name: "Added", values: ["Changed"] }]).apply(edited);
  const reset = restoreFormData(fields).apply(edited);
  expect(reset.formValues[radio.key]).toBe("Second"); expect(reset.formFields![0].value).toBe("");
  expect(reset.importedFormEdits).toBe(edited.importedFormEdits); expect(reset.pages).toBe(edited.pages);
  expect(restoreFormData(fields).apply(reset)).toBe(reset);
  expect((await PDFDocument.load(await exportPdf(reset))).getForm().getRadioGroup("Choice").getSelected()).toBe("Second");
});
it("reads a nonstandard checkbox export state", async () => {
  const pdf = await PDFDocument.create(), page = pdf.addPage(), field = pdf.getForm().createCheckBox("Agree"); field.addToPage(page);
  const dict = field.acroField.getWidgets()[0].getAppearances()!.normal;
  if (!(dict instanceof PDFDict)) throw Error("Missing normal dictionary");
  dict.set(PDFName.of("Custom"), dict.get(PDFName.of("Yes"))!); dict.delete(PDFName.of("Yes"));
  const model = emptyDocument(); model.sources.s = { id: "s", name: "checkbox.pdf", bytes: await pdf.save({ updateFieldAppearances: false }) }; model.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0 }];
  const fields = await inspectForms(model); expect(fields[0].checkboxOnValue).toBe("Custom");
  const imported = applyFormData(fields, [{ name: "Agree", values: ["Custom"] }]).apply(model);
  expect(imported.formValues[fields[0].key]).toBe(true);
});
