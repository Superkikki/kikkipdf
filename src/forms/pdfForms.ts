import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFField,
  PDFHexString,
  PDFName,
  PDFObjectCopier,
  PDFRef,
  PDFString,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  StandardFonts,
  type PDFFont,
  type PDFPage,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { widgetKey } from "./commands";
import type {
  DocumentModel,
  FieldValue,
  FormFieldModel,
  PageModel,
} from "../state/model";

export function setFieldValue(field: PDFField, value: FieldValue) {
  if (field instanceof PDFTextField && typeof value === "string")
    field.setText(value);
  else if (field instanceof PDFCheckBox && typeof value === "boolean") {
    if (value) field.check();
    else field.uncheck();
  } else if (
    (field instanceof PDFDropdown || field instanceof PDFOptionList) &&
    typeof value !== "boolean"
  ) {
    if (value === "" || (Array.isArray(value) && !value.length)) field.clear();
    else field.select(value);
  } else if (field instanceof PDFRadioGroup && typeof value === "string") {
    if (value) field.select(value);
    else field.clear();
  }
}

/** A bounded form transfer. Page/Parent/Kids graphs are rebuilt, never recursively copied.
 * Existing AP streams are preserved. JavaScript, submit actions and signatures are not copied.
 */
export class FormTransfer {
  private widgets = new Map<
    number,
    { field: PDFField; widget: PDFDict; id: string }[]
  >();
  private fields = new Map<PDFRef, { dict: PDFDict; ref: PDFRef }>();
  private copier: PDFObjectCopier;
  constructor(
    private input: PDFDocument,
    private output: PDFDocument,
    private names: Set<string>,
    private font: PDFFont,
  ) {
    this.copier = PDFObjectCopier.for(input.context, output.context);
  }
  async prepare(
    model: DocumentModel,
    sourceId: string,
    fontBytes?: Uint8Array,
  ) {
    if (this.input.catalog.getAcroForm()?.dict.has(PDFName.of("XFA")))
      throw Error("XFAフォームは未対応です。");
    const form = this.input.getForm();
    if (form.hasXFA())
      throw Error(
        "XFAフォームには対応していません。標準AcroFormのPDFを使用してください。",
      );
    const fields = form.getFields();
    if (!model.flattenForms && fields.some((f) => f instanceof PDFSignature))
      throw Error(
        "署名フィールドの再保存は署名を無効にします。必要ならフォーム画面で「固定して保存」を選び、別名保存してください。",
      );
    for (const field of fields) {
      const value = model.formValues[`${sourceId}:${field.getName()}`];
      if (value !== undefined) setFieldValue(field, value);
    }
    if (fields.length) {
      this.input.registerFontkit(fontkit);
      const font = fontBytes
        ? await this.input.embedFont(fontBytes, { subset: false })
        : await this.input.embedFont(StandardFonts.Helvetica);
      form.updateFieldAppearances(font);
      // Appearance fonts need to be materialized before copying their references.
      await this.input.flush();
    }
    const owner = new Map<PDFDict, { field: PDFField; id: string }>();
    for (const f of fields)
      f.acroField
        .getWidgets()
        .forEach((w, index) =>
          owner.set(w.dict, { field: f, id: widgetKey(f.getName(), index) }),
        );
    this.input.getPages().forEach((page, index) => {
      const annots = page.node.Annots();
      if (!annots) return;
      const retained = this.input.context.obj([]);
      const items: { field: PDFField; widget: PDFDict; id: string }[] = [];
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i),
          dict = this.input.context.lookup(ref);
        const entry = dict instanceof PDFDict ? owner.get(dict) : undefined;
        if (entry && dict instanceof PDFDict)
          items.push({ ...entry, widget: dict });
        else retained.push(ref);
      }
      page.node.set(PDFName.of("Annots"), retained);
      this.widgets.set(index, items);
    });
  }
  attach(modelPage: PageModel, page: PDFPage) {
    const context = this.output.context;
    for (const { field, widget, id } of this.widgets.get(
      modelPage.sourceIndex,
    ) ?? []) {
      let target = this.fields.get(field.ref);
      if (!target) {
        const dict = context.obj({});
        for (const key of [
          "FT",
          "Ff",
          "V",
          "DV",
          "Q",
          "Opt",
          "MaxLen",
          "TI",
          "I",
          "TU",
          "TM",
        ]) {
          if (key === "Opt" && field instanceof PDFRadioGroup) continue;
          const value = field.acroField.getInheritableAttribute(
            PDFName.of(key),
          );
          if (value) dict.set(PDFName.of(key), this.copier.copy(value));
        }
        const name = uniqueFieldName(field.getName(), this.names);
        dict.set(PDFName.of("T"), PDFHexString.fromText(name));
        const da =
          field.acroField.getDefaultAppearance() ?? "/KikkiForm 0 Tf 0 g";
        dict.set(
          PDFName.of("DA"),
          PDFString.of(
            /\/\S+\s+[\d.+-]+\s+Tf/.test(da)
              ? da.replace(/\/\S+(\s+[\d.+-]+\s+Tf)/g, "/KikkiForm$1")
              : "/KikkiForm 0 Tf 0 g",
          ),
        );
        dict.set(PDFName.of("Kids"), context.obj([]));
        target = { dict, ref: context.register(dict) };
        this.output.getForm().acroForm.addField(target.ref);
        this.fields.set(field.ref, target);
      }
      const copy = context.obj({ Type: "Annot", Subtype: "Widget" });
      for (const key of [
        "Rect",
        "AP",
        "AS",
        "MK",
        "BS",
        "Border",
        "F",
        "H",
        "Q",
      ]) {
        const value = widget.get(PDFName.of(key));
        if (value) copy.set(PDFName.of(key), this.copier.copy(value));
      }
      copy.set(PDFName.of("Parent"), target.ref);
      copy.set(PDFName.of("P"), page.ref);
      const edit = modelPage.formWidgetEdits?.[id];
      if (edit) {
        const crop = this.input.getPage(modelPage.sourceIndex).getCropBox();
        const x = crop.x + edit.x,
          y = crop.y + crop.height - edit.y - edit.height;
        copy.set(
          PDFName.of("Rect"),
          context.obj([x, y, x + edit.width, y + edit.height]),
        );
        // Rect alone would stretch the old appearance. Rebuild it at final size.
        this.output.getForm().markFieldAsDirty(target.ref);
      }
      const ref = context.register(copy);
      target.dict.lookup(PDFName.of("Kids"), PDFArray).push(ref);
      if (field instanceof PDFRadioGroup) {
        const index = field.acroField
          .getWidgets()
          .findIndex((w) => w.dict === widget);
        let options = target.dict.lookupMaybe(PDFName.of("Opt"), PDFArray);
        if (!options) {
          options = context.obj([]);
          target.dict.set(PDFName.of("Opt"), options);
        }
        options.push(PDFHexString.fromText(field.getOptions()[index] ?? ""));
      }
      page.node.addAnnot(ref);
    }
    const form = this.output.getForm();
    form.acroForm.dict.set(
      PDFName.of("DR"),
      context.obj({ Font: { KikkiForm: this.font.ref } }),
    );
    form.acroForm.dict.set(
      PDFName.of("DA"),
      PDFString.of("/KikkiForm 0 Tf 0 g"),
    );
  }
}

export function uniqueFieldName(proposed: string, names: Set<string>) {
  let name = proposed,
    n = 2;
  while (names.has(name)) name = `${proposed}_${n++}`;
  names.add(name);
  return name;
}

export function createFormField(
  output: PDFDocument,
  field: FormFieldModel,
  page: PDFPage,
  modelPage: PageModel,
  font: PDFFont,
  names: Set<string>,
) {
  if (!field.name.trim())
    throw Error("フォームのフィールド名を入力してください。");
  if (
    ["radio", "dropdown", "list"].includes(field.kind) &&
    (!field.options.length ||
      field.options.some((v) => !v.trim()) ||
      new Set(field.options).size !== field.options.length)
  )
    throw Error(`「${field.name}」の選択肢は空欄と重複を除いてください。`);
  const form = output.getForm(),
    name = uniqueFieldName(field.name, names);
  const base = page.getCropBox();
  const options = {
    x: base.x + field.x,
    y: base.y + modelPage.height - field.y - field.height,
    width: field.width,
    height: field.height,
    font,
    borderWidth: 1,
    borderColor: rgb(0.4, 0.5, 0.6),
    backgroundColor: rgb(0.96, 0.98, 1),
    textColor: rgb(0.1, 0.15, 0.2),
  };
  let created: PDFField;
  if (field.kind === "text") {
    const f = form.createTextField(name);
    if (field.multiline) f.enableMultiline();
    if (field.maxLength !== undefined) f.setMaxLength(field.maxLength);
    f.addToPage(page, options);
    f.setFontSize(field.fontSize);
    created = f;
  } else if (field.kind === "checkbox") {
    const f = form.createCheckBox(name);
    f.addToPage(page, options);
    created = f;
  } else if (field.kind === "radio") {
    const f = form.createRadioGroup(name);
    const size = Math.min(field.height / Math.max(1, field.options.length), 20);
    field.options.forEach((option, i) => {
      const y = options.y + field.height - size * (i + 1);
      f.addOptionToPage(option, page, {
        ...options,
        y,
        width: size,
        height: size,
      });
      page.drawText(option, {
        x: options.x + size + 6,
        y: y + 3,
        size: field.fontSize,
        font,
      });
    });
    created = f;
  } else {
    const f =
      field.kind === "dropdown"
        ? form.createDropdown(name)
        : form.createOptionList(name);
    f.setOptions(field.options);
    if (field.multiSelect) f.enableMultiselect();
    f.addToPage(page, options);
    f.setFontSize(field.fontSize);
    created = f;
  }
  setFieldValue(created, field.value);
  if (field.readOnly) created.enableReadOnly();
  if (field.required) created.enableRequired();
  // Unlike appearance subsets, the shared full font permits future input in other viewers.
  created.acroField.setDefaultAppearance(`/KikkiForm ${field.fontSize} Tf 0 g`);
  if (
    created instanceof PDFTextField ||
    created instanceof PDFDropdown ||
    created instanceof PDFOptionList
  )
    created.updateAppearances(font);
}
