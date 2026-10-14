import { zipSync, unzipSync, strFromU8, strToU8 } from "fflate";
import { expect, it } from "vitest";
import { PDFDocument, PDFName, PDFHexString, PDFDict } from "pdf-lib";
import { blankPage, emptyDocument } from "../src/state/model";
import { inspectForms, exportPdf } from "../src/export/engine";
import { applyFormData, dataFields, restoreFormData, resetFormDataToDefaults, setFormDefaults, formValueStrings } from "../src/forms/data";
import { formDataXfdf } from "../src/forms/xfdf";
import { updateImportedForm } from "../src/forms/commands";
import { History } from "../src/commands/history";
import { openProject, saveProject } from "../src/state/project";

async function fixture(defaults = false) {
  const pdf = await PDFDocument.create(), page = pdf.addPage(), other = pdf.addPage(), form = pdf.getForm();
  const text = form.createTextField("Customer.Name"); text.setText("Before"); text.enableMultiline(); text.setMaxLength(12); text.addToPage(page);
  const check = form.createCheckBox("Agree"); check.addToPage(page);
  const radio = form.createRadioGroup("Choice"); radio.addOptionToPage("A", page); radio.addOptionToPage("B", page); radio.select("B");
  const dropdown = form.createDropdown("Color"); dropdown.setOptions(["Red", "Green"]); dropdown.addToPage(page);
  dropdown.acroField.setOptions([{ value: PDFHexString.fromText("R"), display: PDFHexString.fromText("Red") }, { value: PDFHexString.fromText("G"), display: PDFHexString.fromText("Green") }]);
  dropdown.select("R");
  const list = form.createOptionList("Tags"); list.setOptions(["One", "Two", "Three"]); list.enableMultiselect(); list.addToPage(page); list.select(["One", "Three"]);
  const hidden = form.createTextField("Removed"); hidden.addToPage(other);
  if (defaults) {
    text.acroField.getParent()!.dict.set(PDFName.of("DV"), pdf.context.register(PDFHexString.fromText("Default")));
    check.acroField.dict.set(PDFName.of("DV"), check.acroField.getOnValue()!);
    radio.acroField.dict.set(PDFName.of("DV"), radio.acroField.getOnValues()[0]);
    dropdown.acroField.dict.set(PDFName.of("DV"), PDFHexString.fromText("G"));
    list.acroField.dict.set(PDFName.of("DV"), pdf.context.obj([PDFHexString.fromText("Two"), PDFHexString.fromText("Three")]));
    hidden.acroField.dict.set(PDFName.of("DV"), pdf.context.obj(42));
  }
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
  field.acroField.dict.set(PDFName.of("DV"), PDFName.of("Custom"));
  const model = emptyDocument(); model.sources.s = { id: "s", name: "checkbox.pdf", bytes: await pdf.save({ updateFieldAppearances: false }) }; model.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0 }];
  const fields = await inspectForms(model); expect(fields[0].checkboxOnValue).toBe("Custom");
  expect(fields[0].defaultValue).toBe(true);
  expect(resetFormDataToDefaults(fields).apply(model).formValues[fields[0].key]).toBe(true);
  const imported = applyFormData(fields, [{ name: "Agree", values: ["Custom"] }]).apply(model);
  expect(imported.formValues[fields[0].key]).toBe(true);
});
it("resets inherited/indirect DV and all five kinds atomically with history and saved defaults", async () => {
  const { model, fields } = await fixture(true), history = new History(model);
  const radio = fields.find(field => field.kind === "radio")!;
  history.execute(updateImportedForm(radio, { options: ["First", "Second"] }));
  const before = history.current.document, bytes = model.sources.s.bytes.slice();
  history.execute(resetFormDataToDefaults(fields));
  const reset = history.current.document;
  expect(reset.formValues).toEqual({ "s:Customer.Name": "Default", "s:Agree": true, "s:Choice": "First", "s:Color": "G", "s:Tags": ["Two", "Three"] });
  expect(reset.formFields![0].value).toBe(""); expect(reset.pages).toBe(before.pages); expect(reset.importedFormEdits).toBe(before.importedFormEdits);
  expect(reset.sources.s.bytes).toEqual(bytes);
  history.undo(); expect(history.current.document).toBe(before); history.redo(); expect(history.current.document).toBe(reset);
  expect(resetFormDataToDefaults(fields).apply(reset)).toBe(reset);
  const project = await openProject(await saveProject(reset));
  expect(project.formValues).toEqual(reset.formValues);
  const output = await exportPdf(project), pdf = await PDFDocument.load(output), form = pdf.getForm();
  expect(form.getTextField("Customer.Name").getText()).toBe("Default"); expect(form.getCheckBox("Agree").isChecked()).toBe(true);
  expect(form.getRadioGroup("Choice").getSelected()).toBe("First"); expect(form.getDropdown("Color").getSelected()).toEqual(["G"]);
  expect(form.getOptionList("Tags").getSelected()).toEqual(["Two", "Three"]);
  const reopened = emptyDocument(); reopened.sources.s = { id: "s", name: "reset.pdf", bytes: output };
  const reread = await inspectForms(reopened);
  expect(reread.find(field => field.name === "Customer.Name")?.defaultValue).toBe("Default");
  expect(reread.find(field => field.name === "Choice")?.defaultValue).toBe("First");
});
it("clears fields without DV and preserves readonly fields", async () => {
  const { model, fields } = await fixture();
  const readonly = updateImportedForm(fields.find(field => field.kind === "radio")!, { readOnly: true }).apply(model);
  const reset = resetFormDataToDefaults(fields).apply(readonly);
  expect(reset.formValues).toEqual({ "s:Customer.Name": "", "s:Color": "", "s:Tags": [] });
  expect(reset.formFields![0].value).toBe(""); expect(resetFormDataToDefaults(fields).apply(reset)).toBe(reset);
});
it("rejects incompatible or malformed defaults without partial changes or history", async () => {
  const { model, fields } = await fixture(true);
  const shortened = applyFormData(fields, [{ name: "Customer.Name", values: ["OK"] }]).apply(model);
  const limited = updateImportedForm(fields.find(field => field.kind === "text")!, { maxLength: 2 }).apply(shortened);
  const changedOptions = updateImportedForm(fields.find(field => field.kind === "dropdown")!, { choiceOptions: [{ value: "R", label: "Red" }] }).apply(model);
  for (const edited of [limited, changedOptions]) {
    const history = new History(edited);
    expect(() => history.execute(resetFormDataToDefaults(fields))).toThrow();
    expect(history.current.document).toBe(edited); expect(history.canUndo).toBe(false); expect(history.dirty).toBe(false);
  }
  const pdf = await PDFDocument.load(model.sources.s.bytes);
  pdf.getForm().getCheckBox("Agree").acroField.dict.set(PDFName.of("DV"), PDFName.of("Unknown"));
  const broken = { ...model, sources: { s: { ...model.sources.s, bytes: await pdf.save() } } };
  const inspected = await inspectForms(broken);
  expect(inspected.find(field => field.name === "Agree")?.defaultValueError).toBeTruthy();
  const history = new History(broken);
  expect(() => history.execute(resetFormDataToDefaults(inspected))).toThrow(/Agree.*既定値/);
  expect(history.current.document).toBe(broken); expect(history.canUndo).toBe(false);
  expect(() => restoreFormData(inspected).apply(broken)).not.toThrow();
  const readonly = updateImportedForm(inspected.find(field => field.name === "Agree")!, { readOnly: true }).apply(broken);
  expect(() => resetFormDataToDefaults(inspected).apply(readonly)).not.toThrow();
});
it("reports malformed DV per field while leaving ordinary form inspection usable", async () => {
  const { model } = await fixture(true), pdf = await PDFDocument.load(model.sources.s.bytes), form = pdf.getForm();
  form.getTextField("Customer.Name").acroField.dict.set(PDFName.of("DV"), PDFName.of("WrongType"));
  form.getCheckBox("Agree").acroField.dict.set(PDFName.of("DV"), PDFHexString.fromText("Yes"));
  form.getRadioGroup("Choice").acroField.dict.set(PDFName.of("DV"), PDFName.of("Unknown"));
  form.getDropdown("Color").acroField.dict.set(PDFName.of("DV"), pdf.context.obj([PDFHexString.fromText("R"), PDFHexString.fromText("G")]));
  form.getOptionList("Tags").acroField.dict.set(PDFName.of("DV"), pdf.context.obj([PDFHexString.fromText("Two"), PDFHexString.fromText("Two")]));
  const inspected = await inspectForms({ sources: { s: { ...model.sources.s, bytes: await pdf.save() } } });
  for (const field of inspected) expect(field.defaultValueError, field.name).toBeTruthy();
  expect(inspected.find(field => field.name === "Customer.Name")?.value).toBe("Before");
});

it("sets all five defaults plus added fields without changing input and round trips projects and PDF", async () => {
  const { model, fields } = await fixture(true);
  const original = model.sources.s.bytes.slice(), history = new History(model);
  history.execute(setFormDefaults(fields));
  const saved = history.current.document;
  expect(saved.formValues).toBe(model.formValues);
  expect(saved.formFields![0]).toMatchObject({ value: "New", defaultValue: "New" });
  expect(saved.pages).toBe(model.pages); expect(saved.sources.s.bytes).toEqual(original);
  expect(setFormDefaults(fields).apply(saved)).toBe(saved);
  history.undo(); expect(history.current.document).toBe(model); history.redo();
  const project = await openProject(await saveProject(saved));
  const bytes = await exportPdf(project), reopened = emptyDocument();
  reopened.sources.s = { id: "s", name: "defaults.pdf", bytes };
  const inspected = await inspectForms(reopened);
  const defaults = Object.fromEntries(inspected.map(field => [field.name, field.defaultValue]));
  expect(defaults).toEqual({ "Customer.Name": "Before", Agree: false, Choice: "B", Color: "R", Tags: ["One", "Three"], Added: "New" });
  const edited = applyFormData(fields, [{ name: "Customer.Name", values: ["Other"] }, { name: "Agree", values: ["Yes"] },
    { name: "Choice", values: ["A"] }, { name: "Color", values: ["G"] }, { name: "Tags", values: [] }, { name: "Added", values: ["Other"] }]).apply(project);
  const reset = resetFormDataToDefaults(fields).apply(edited);
  expect(reset.formFields![0].value).toBe("New");
  expect(dataFields(reset, fields).map(formValueStrings)).toEqual(dataFields(model, fields).map(formValueStrings));
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getForm().getTextField("Customer.Name").getText()).toBe("Before");
  expect(pdf.getForm().getCheckBox("Agree").isChecked()).toBe(false);
});
it("removes inherited defaults, preserves readonly defaults and input, and suppresses repeated clear history", async () => {
  const { model, fields } = await fixture(true), check = fields.find(field => field.kind === "checkbox")!;
  const readonly = updateImportedForm(check, { readOnly: true }).apply(model);
  readonly.formFields![0].defaultValue = "Added default";
  const history = new History(readonly); history.execute(setFormDefaults(fields, true));
  const cleared = history.current.document;
  expect(cleared.formValues).toBe(readonly.formValues);
  expect(cleared.formFields![0].value).toBe("New"); expect(cleared.formFields![0].defaultValue).toBeUndefined();
  expect(setFormDefaults(fields, true).apply(cleared)).toBe(cleared);
  const bytes = await exportPdf(await openProject(await saveProject(cleared)));
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getForm().getCheckBox("Agree").acroField.dict.has(PDFName.of("DV"))).toBe(true);
  for (const field of pdf.getForm().getFields().filter(field => field.getName() !== "Agree"))
    expect(field.acroField.getInheritableAttribute(PDFName.of("DV"))).toBeUndefined();
  history.undo(); expect(history.current.document).toBe(readonly);
});
it("rejects invalid current inputs atomically and validates edited defaults on setting changes and persistence", async () => {
  const { model, fields } = await fixture(), tags = fields.find(field => field.kind === "list")!, text = fields.find(field => field.kind === "text")!;
  model.formValues[tags.key] = ["Unknown"];
  const history = new History(model);
  expect(() => history.execute(setFormDefaults(fields))).toThrow(/選択肢/);
  expect(history.current.document).toBe(model); expect(history.canUndo).toBe(false);
  delete model.formValues[tags.key];
  const edited = setFormDefaults(fields).apply(model);
  edited.formValues[text.key] = "OK";
  expect(() => updateImportedForm(text, { maxLength: 2 }).apply(edited)).toThrow(/最大文字数/);
  expect(() => updateImportedForm(tags, { multiSelect: false }).apply(edited)).toThrow(/複数選択/);
  const broken = { ...edited, importedFormEdits: { ...edited.importedFormEdits, [text.key]: { defaultValue: true } } };
  await expect(saveProject(broken)).rejects.toThrow(/既定値/);
  await expect(exportPdf(broken)).rejects.toThrow(/既定値/);
  const brokenAdded = { ...edited, formFields: [{ ...edited.formFields![0], defaultValue: false }] };
  await expect(saveProject(brokenAdded)).rejects.toThrow(/既定値/);
  await expect(exportPdf(brokenAdded)).rejects.toThrow(/既定値/);
});
it("preserves an edited radio default position over repeated renaming including swaps", async () => {
  const { model, fields } = await fixture(), radio = fields.find(field => field.kind === "radio")!;
  let edited = setFormDefaults(fields).apply(model);
  edited = updateImportedForm(radio, { options: ["B", "A"] }).apply(edited);
  expect(dataFields(edited, fields).find(field => field.key === radio.key)?.defaultValue).toBe("A");
  edited = updateImportedForm(radio, { options: ["First", "Second"] }).apply(edited);
  edited = applyFormData(fields, [{ name: "Choice", values: ["First"] }]).apply(edited);
  const reset = resetFormDataToDefaults(fields).apply(edited);
  expect(reset.formValues[radio.key]).toBe("Second");
  const inspected = await inspectForms({ sources: { s: { id: "s", name: "radio.pdf", bytes: await exportPdf(reset) } } });
  expect(inspected.find(field => field.kind === "radio")?.defaultValue).toBe("Second");
});
it("repairs malformed PDF defaults by setting or clearing without changing current input", async () => {
  const { model } = await fixture(), pdf = await PDFDocument.load(model.sources.s.bytes);
  pdf.getForm().getCheckBox("Agree").acroField.dict.set(PDFName.of("DV"), PDFName.of("Broken"));
  model.sources.s.bytes = await pdf.save();
  const fields = await inspectForms(model);
  for (const clear of [true, false]) {
    const edited = setFormDefaults(fields, clear).apply(model);
    expect(() => resetFormDataToDefaults(fields).apply(edited)).not.toThrow();
    const output = await inspectForms({ sources: { s: { ...model.sources.s, bytes: await exportPdf(edited) } } });
    expect(output.find(field => field.name === "Agree")?.defaultValueError).toBeUndefined();
  }
});

it("saves and resets defaults for all created field kinds and rejects corrupted project defaults", async () => {
  const model = emptyDocument(); model.pages = [blankPage()];
  const base = { id: "text", pageId: model.pages[0].id, name: "text", kind: "text" as const,
    value: "Draft", x: 20, y: 20, width: 160, height: 40, options: [], fontSize: 12,
    readOnly: false, required: false, multiline: false };
  model.formFields = [base, { ...base, id: "check", name: "check", kind: "checkbox", value: true, y: 80 },
    { ...base, id: "radio", name: "radio", kind: "radio", options: ["A", "B"], value: "B", y: 140 },
    { ...base, id: "dropdown", name: "dropdown", kind: "dropdown", options: ["A", "B"], value: "A", y: 200 },
    { ...base, id: "list", name: "list", kind: "list", options: ["A", "B"], value: ["A", "B"], multiSelect: true, y: 260 }];
  const edited = setFormDefaults([]).apply(model);
  const archived = await saveProject(edited), restored = await openProject(archived);
  expect(restored.formFields!.map(field => field.defaultValue)).toEqual(["Draft", true, "B", "A", ["A", "B"]]);
  const bytes = await exportPdf(restored), fields = await inspectForms({ sources: { s: { id: "s", name: "added.pdf", bytes } } });
  expect(fields.map(field => field.defaultValue)).toEqual(["Draft", true, "B", "A", ["A", "B"]]);
  const cleared = { ...restored, formFields: restored.formFields!.map(field => ({ ...field, value: field.kind === "checkbox" ? false : field.multiSelect ? [] : "" })) };
  expect(resetFormDataToDefaults([]).apply(cleared).formFields!.map(field => field.value)).toEqual(model.formFields!.map(field => field.value));
  const archive = unzipSync(archived), manifest = JSON.parse(strFromU8(archive["document.json"]));
  manifest.document.formFields[0].defaultValue = true;
  archive["document.json"] = strToU8(JSON.stringify(manifest));
  await expect(openProject(zipSync(archive))).rejects.toThrow(/既定値/);
  const imported = await fixture();
  const saved = unzipSync(await saveProject(setFormDefaults(imported.fields).apply(imported.model)));
  const data = JSON.parse(strFromU8(saved["document.json"]));
  data.document.importedFormEdits["s:Choice"].defaultValue = "Unknown";
  saved["document.json"] = strToU8(JSON.stringify(data));
  await expect(openProject(zipSync(saved))).rejects.toThrow(/選択肢/);
});
