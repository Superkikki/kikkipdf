import { expect, it } from "vitest";
import { PDFDocument, PDFName, PDFHexString, PDFArray, type PDFRawStream } from "pdf-lib";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { blankPage, emptyDocument } from "../src/state/model";
import { exportPdf, inspectForms } from "../src/export/engine";
import {
  updateImportedForm,
  resetImportedForm,
  updateFormWidget,
} from "../src/forms/commands";
import { resolveImportedForm } from "../src/forms/importedSettings";
import { History } from "../src/commands/history";
import {
  duplicatePage,
  mergeDocuments,
  reorderPage,
} from "../src/commands/document";
import { openProject, saveProject } from "../src/state/project";

async function fixture(id = "s") {
  const input = await PDFDocument.create(),
    a = input.addPage(),
    b = input.addPage();
  const form = input.getForm();
  const text = form.createTextField("Shared.Name");
  text.setText("Original");
  text.setMaxLength(10);
  text.enableReadOnly();
  text.addToPage(a, { x: 30, y: 600, width: 200, height: 40 });
  text.addToPage(b, { x: 30, y: 600, width: 200, height: 40 });
  const check = form.createCheckBox("Consent");
  check.check();
  check.addToPage(a);
  const radio = form.createRadioGroup("Choice");
  radio.addOptionToPage("A", a);
  radio.addOptionToPage("B", b);
  radio.select("B");
  const dropdown = form.createDropdown("Color");
  dropdown.setOptions(["Red", "Green", "Blue"]);
  dropdown.select("Green");
  dropdown.acroField.dict.set(PDFName.of("DV"), PDFHexString.fromText("Green"));
  dropdown.addToPage(a, { x: 30, y: 450, width: 200, height: 30 });
  const list = form.createOptionList("Tags");
  list.setOptions(["One", "Two", "Three"]);
  list.enableMultiselect();
  list.select(["One", "Three"]);
  list.addToPage(b, { x: 30, y: 450, width: 200, height: 80 });
  const model = emptyDocument();
  model.sources[id] = { id, name: "form.pdf", bytes: await input.save() };
  model.pages = [a, b].map((_, sourceIndex) => ({
    ...blankPage(),
    sourceId: id,
    sourceIndex,
  }));
  return { model, fields: await inspectForms(model) };
}

it("renames and changes flags on all five imported kinds without changing shared values or widget identities", async () => {
  const { model: initial, fields } = await fixture();
  let model = initial;
  const original = model.sources.s.bytes.slice();
  for (const field of fields)
    model = updateImportedForm(field, {
      name: `Edited.${field.name}`,
      required: true,
      readOnly: field.kind !== "text",
      ...(field.kind === "text" ? { multiline: true, maxLength: 20 } : {}),
    }).apply(model);
  const text = fields.find((f) => f.kind === "text")!;
  model = updateFormWidget(model.pages[0].id, text.widgets[0].id, {
    x: 80,
    y: 70,
    width: 210,
    height: 50,
  }).apply(model);
  model.formValues[text.key] = "Two\nlines";
  const pdf = await PDFDocument.load(await exportPdf(model));
  expect(pdf.getForm().getFields()).toHaveLength(5);
  for (const field of fields) {
    const saved = pdf.getForm().getField(`Edited.${field.name}`);
    expect(saved.isRequired()).toBe(true);
    expect(saved.isReadOnly()).toBe(field.kind !== "text");
  }
  const saved = pdf.getForm().getTextField("Edited.Shared.Name");
  expect(saved.getText()).toBe("Two\nlines");
  expect(saved.isMultiline()).toBe(true);
  expect(saved.getMaxLength()).toBe(20);
  expect(saved.acroField.getWidgets()).toHaveLength(2);
  expect(saved.acroField.getWidgets()[0].getRectangle().width).toBe(210);
  expect(pdf.getForm().getCheckBox("Edited.Consent").isChecked()).toBe(true);
  expect(pdf.getForm().getRadioGroup("Edited.Choice").getSelected()).toBe("B");
  expect(pdf.getForm().getDropdown("Edited.Color").getSelected()).toEqual([
    "Green",
  ]);
  expect(resolveImportedForm(text, model)).toMatchObject({
    name: "Edited.Shared.Name",
    key: "s:Shared.Name",
    readOnly: false,
  });
  expect(model.sources.s.bytes).toEqual(original);
});

it("validates a shorter text limit atomically, removes limits and sets longer values before the new limit", async () => {
  const { model, fields } = await fixture(),
    text = fields.find((f) => f.kind === "text")!;
  const history = new History(model);
  expect(() =>
    history.execute(updateImportedForm(text, { maxLength: 3 })),
  ).toThrow("現在の入力値");
  expect(history.canUndo).toBe(false);
  history.execute(updateImportedForm(text, { maxLength: 30, readOnly: false }));
  const edited = {
    ...history.current.document,
    formValues: { [text.key]: "A much longer input" },
  };
  const pdf = await PDFDocument.load(await exportPdf(edited));
  expect(pdf.getForm().getTextField(text.name).getText()).toBe(
    "A much longer input",
  );
  expect(pdf.getForm().getTextField(text.name).getMaxLength()).toBe(30);
  const unlimited = updateImportedForm(text, { maxLength: null }).apply(edited);
  expect(resolveImportedForm(text, unlimited).maxLength).toBeUndefined();
  expect(
    (await PDFDocument.load(await exportPdf(unlimited)))
      .getForm()
      .getTextField(text.name)
      .getMaxLength(),
  ).toBeUndefined();
  expect(() => resetImportedForm(text).apply(unlimited)).toThrow(
    "元の最大文字数",
  );
});

it("updates choice options and values together, sanitizes defaults and restores them with one undo", async () => {
  const { model, fields } = await fixture(),
    color = fields.find((f) => f.kind === "dropdown")!;
  const history = new History(model);
  history.execute(
    updateImportedForm(color, { options: ["Red", "Yellow"], required: true }),
  );
  expect(history.current.document.formValues[color.key]).toBe("");
  let pdf = await PDFDocument.load(await exportPdf(history.current.document));
  expect(pdf.getForm().getDropdown("Color").getOptions()).toEqual([
    "Red",
    "Yellow",
  ]);
  expect(pdf.getForm().getDropdown("Color").getSelected()).toEqual([]);
  expect(
    pdf.getForm().getDropdown("Color").acroField.dict.has(PDFName.of("DV")),
  ).toBe(false);
  history.undo();
  expect(history.current.document).toBe(model);
  history.redo();
  history.execute(resetImportedForm(color));
  expect(resolveImportedForm(color, history.current.document).options).toEqual(
    color.options,
  );
  history.undo();
  expect(resolveImportedForm(color, history.current.document).options).toEqual([
    "Red",
    "Yellow",
  ]);
  const tags = fields.find((f) => f.kind === "list")!;
  history.execute(updateImportedForm(tags, { multiSelect: false }));
  expect(history.current.document.formValues[tags.key]).toBe("One");
  pdf = await PDFDocument.load(await exportPdf(history.current.document));
  expect(pdf.getForm().getOptionList("Tags").isMultiselect()).toBe(false);
  expect(pdf.getForm().getOptionList("Tags").getSelected()).toEqual(["One"]);
});

it("keeps settings through projects, merge, duplication, reordering and extraction with collision suffixes", async () => {
  const first = await fixture(),
    second = await fixture("other");
  let model = updateImportedForm(first.fields[0], {
    name: "Renamed",
    readOnly: false,
  }).apply(first.model);
  second.model = updateImportedForm(second.fields[0], {
    name: "Renamed",
    required: true,
  }).apply(second.model);
  model = mergeDocuments(second.model).apply(model);
  model = duplicatePage(model.pages[0].id).apply(model);
  const copy = model.pages[1];
  model = reorderPage(copy.id, model.pages[0].id).apply(model);
  const restored = await openProject(await saveProject(model));
  expect(restored.importedFormEdits).toEqual(model.importedFormEdits);
  const pdf = await PDFDocument.load(await exportPdf(restored));
  expect(
    pdf.getForm().getTextField("Renamed").acroField.getWidgets(),
  ).toHaveLength(3);
  expect(pdf.getForm().getTextField("Renamed_2").isRequired()).toBe(true);
  const extracted = await PDFDocument.load(
    await exportPdf(restored, undefined, { indices: [0] }),
  );
  expect(
    extracted.getForm().getTextField("Renamed").acroField.getWidgets(),
  ).toHaveLength(1);
  const legacy = await fixture();
  expect(
    (await openProject(await saveProject(legacy.model))).importedFormEdits,
  ).toBeUndefined();
});

it("rejects empty names, invalid options, incompatible settings and broken project references", async () => {
  const { model, fields } = await fixture(),
    text = fields[0],
    color = fields.find((f) => f.kind === "dropdown")!;
  for (const patch of [
    { name: " " },
    { maxLength: 0 },
    { maxLength: 1.5 },
    { options: ["A"] },
  ])
    expect(() => updateImportedForm(text, patch).apply(model)).toThrow();
  for (const options of [[], [" "], ["A", "A"]])
    expect(() => updateImportedForm(color, { options }).apply(model)).toThrow();
  expect(() =>
    updateImportedForm(fields.find((f) => f.kind === "radio")!, {
      options: ["C"],
    }).apply(model),
  ).toThrow();
  const invalid = {
    ...model,
    importedFormEdits: { missing: { name: "Changed" } },
  };
  await expect(exportPdf(invalid)).rejects.toThrow("参照先");
  await expect(saveProject(invalid)).rejects.toThrow("参照先");
  const archive = unzipSync(await saveProject(model));
  const manifest = JSON.parse(strFromU8(archive["document.json"]));
  manifest.document.importedFormEdits = { [text.key]: { maxLength: 3 } };
  archive["document.json"] = strToU8(JSON.stringify(manifest));
  await expect(openProject(zipSync(archive))).rejects.toThrow("最大文字数");
  manifest.document.importedFormEdits = { [text.key]: { options: ["A"] } };
  archive["document.json"] = strToU8(JSON.stringify(manifest));
  await expect(openProject(zipSync(archive))).rejects.toThrow("ドロップダウン");
});

it("preserves paired export/display values when renaming or changing flags and accepts multiselect settings", async () => {
  const input = await PDFDocument.create(),
    page = input.addPage();
  const choice = input.getForm().createDropdown("Paired");
  choice.setOptions(["Red", "Green"]);
  choice.select("Green");
  choice.addToPage(page);
  choice.acroField.dict.set(
    PDFName.of("Opt"),
    input.context.obj([
      [PDFHexString.fromText("R"), PDFHexString.fromText("Red")],
      [PDFHexString.fromText("G"), PDFHexString.fromText("Green")],
    ]),
  );
  choice.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("G"));
  const model = emptyDocument();
  model.sources.s = {
    id: "s",
    name: "paired.pdf",
    bytes: await input.save({ updateFieldAppearances: false }),
  };
  model.pages = [{ ...blankPage(), sourceId: "s" }];
  const [field] = await inspectForms(model);
  expect(field.hasExportValues).toBe(true);
  const edited = updateImportedForm(field, {
    name: "Renamed",
    readOnly: true,
  }).apply(model);
  expect(edited.formValues).toBe(model.formValues);
  const pdf = await PDFDocument.load(await exportPdf(edited));
  expect(pdf.getForm().getDropdown("Renamed").getSelected()).toEqual(["G"]);
  expect(
    pdf
      .getForm()
      .getDropdown("Renamed")
      .acroField.dict.lookup(PDFName.of("Opt"), PDFArray)
      .toString(),
  ).toBe(choice.acroField.dict.lookup(PDFName.of("Opt"), PDFArray).toString());
  expect(() =>
    updateImportedForm(field, { options: ["Red"] }).apply(model),
  ).toThrow("表示名と保存値");
  const multi = updateImportedForm(field, { multiSelect: true }).apply(model);
  expect(resolveImportedForm(field, multi).value).toEqual(["G"]);
  expect(
    (await PDFDocument.load(await exportPdf(multi)))
      .getForm()
      .getDropdown(field.name)
      .isMultiselect(),
  ).toBe(true);
});

it("keeps choice export values, indices, defaults and appearances across editing, project restore and flattening", async () => {
  const input = await PDFDocument.create(),
    page = input.addPage();
  for (const kind of ["dropdown", "list"] as const) {
    const field =
      kind === "dropdown"
        ? input.getForm().createDropdown(kind)
        : input.getForm().createOptionList(kind);
    field.setOptions(["Red", "Green", "Blue"]);
    field.addToPage(page, {
      x: 30,
      y: kind === "dropdown" ? 600 : 400,
      width: 200,
      height: 80,
    });
    field.acroField.setOptions([
      {
        value: PDFHexString.fromText("R"),
        display: PDFHexString.fromText("Red"),
      },
      {
        value: PDFHexString.fromText("G"),
        display: PDFHexString.fromText("Green"),
      },
      {
        value: PDFHexString.fromText("B"),
        display: PDFHexString.fromText("Blue"),
      },
    ]);
    field.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("G"));
    field.acroField.dict.set(PDFName.of("DV"), PDFHexString.fromText("G"));
  }
  let model = emptyDocument();
  model.sources.s = {
    id: "s",
    name: "paired.pdf",
    bytes: await input.save({ updateFieldAppearances: false }),
  };
  model.pages = [{ ...blankPage(), sourceId: "s" }];
  const fields = await inspectForms(model);
  expect(fields[0].choiceOptions).toEqual([
    { value: "R", label: "Red" },
    { value: "G", label: "Green" },
    { value: "B", label: "Blue" },
  ]);
  for (const field of fields) {
    model = updateImportedForm(field, {
      multiSelect: true,
      choiceOptions: [
        { value: "G", label: "Grass" },
        { value: "R", label: "Rose" },
        { value: "Y", label: "Yellow" },
      ],
    }).apply(model);
    model.formValues[field.key] = ["Y", "G"];
  }
  model = await openProject(await saveProject(model));
  const bytes = await exportPdf(model);
  const pdf = await PDFDocument.load(bytes);
  for (const descriptor of fields) {
    const field =
      descriptor.kind === "dropdown"
        ? pdf.getForm().getDropdown(descriptor.name)
        : pdf.getForm().getOptionList(descriptor.name);
    expect(field.getSelected()).toEqual(["G", "Y"]);
    expect(field.getOptions()).toEqual(["Grass", "Rose", "Yellow"]);
    expect(
      field.acroField.dict
        .lookup(PDFName.of("I"), PDFArray)
        .asArray()
        .map((v) => Number(v.toString())),
    ).toEqual([0, 2]);
    expect(
      field.acroField.dict
        .lookup(PDFName.of("DV"), PDFArray)
        .asArray()
        .map((v) => (v as PDFHexString).decodeText()),
    ).toEqual(["G"]);
    expect(
      field instanceof (await import("pdf-lib")).PDFDropdown &&
        field.isEditable(),
    ).toBe(false);
  }
  const { decodePDFRawStream, PDFDict } = await import("pdf-lib");
  const dropdown = pdf.getForm().getDropdown("dropdown");
  const appearance = dropdown.acroField
    .getWidgets()[0]
    .dict.lookup(PDFName.of("AP"), PDFDict)
    .lookup(PDFName.of("N")) as PDFRawStream;
  expect(
    new TextDecoder().decode(decodePDFRawStream(appearance).decode()),
  ).toContain("4772617373"); // Grass, not raw G
  const flat = await PDFDocument.load(
    await exportPdf({ ...model, flattenForms: true }),
  );
  expect(flat.getForm().getFields()).toHaveLength(0);
  const descriptor = fields[0];
  const history = new History(model);
  history.execute(
    updateImportedForm(descriptor, {
      multiSelect: false,
      choiceOptions: [{ value: "G", label: "Green" }],
    }),
  );
  expect(history.current.document.formValues[descriptor.key]).toBe("G");
  history.undo();
  expect(history.current.document.formValues[descriptor.key]).toEqual([
    "Y",
    "G",
  ]);
  const reset = resetImportedForm(descriptor).apply(model);
  expect(reset.formValues[descriptor.key]).toBe("G");
  expect(() =>
    updateImportedForm(descriptor, {
      choiceOptions: [
        { value: "G", label: "A" },
        { value: "G", label: "B" },
      ],
    }).apply(model),
  ).toThrow("重複");
  expect(() =>
    updateImportedForm(descriptor, { choiceOptions: [] }).apply(model),
  ).toThrow();
  const removed = updateImportedForm(descriptor, {
    choiceOptions: [{ value: "R", label: "Rose" }],
  }).apply(model);
  const removedPdf = await PDFDocument.load(await exportPdf(removed));
  expect(removedPdf.getForm().getDropdown("dropdown").getSelected()).toEqual(
    [],
  );
  expect(
    removedPdf
      .getForm()
      .getDropdown("dropdown")
      .acroField.dict.has(PDFName.of("DV")),
  ).toBe(false);
});
