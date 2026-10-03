import {
  defaultDropdownAppearanceProvider,
  defaultOptionListAppearanceProvider,
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
import {
  normalizeChoiceValue,
  validateImportedFormEdit,
} from "./importedSettings";
import type {
  DocumentModel,
  FieldValue,
  FormFieldModel,
  ImportedFormEdit,
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
    else {
      const selected = [...new Set(Array.isArray(value) ? value : [value])];
      const options = field.acroField.getOptions();
      // /V arrays and /I must use the same option order.
      selected.sort((a, b) => options.findIndex((o) => o.value.decodeText() === a) - options.findIndex((o) => o.value.decodeText() === b));
      if (!field.isMultiselect() && selected.length > 1)
        throw Error("単一選択欄では複数の値を保存できません。");
      if (
        selected.some(
          (v) => !options.some((o) => o.value.decodeText() === v),
        ) &&
        !(field instanceof PDFDropdown && field.isEditable())
      )
        throw Error("選択肢にない保存値です。");
      // pdf-lib validates display labels rather than export values, so write /V and /I explicitly.
      const dict = field.acroField.dict;
      dict.set(
        PDFName.of("V"),
        selected.length === 1
          ? PDFHexString.fromText(selected[0])
          : dict.context.obj(selected.map((v) => PDFHexString.fromText(v))),
      );
      const indices = selected
        .map((v) => options.findIndex((o) => o.value.decodeText() === v))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
      if (indices.length) dict.set(PDFName.of("I"), dict.context.obj(indices));
      else dict.delete(PDFName.of("I"));
      field.doc.getForm().markFieldAsDirty(field.ref);
    }
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
  private edits = new Map<PDFRef, ImportedFormEdit>();
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
      const key = `${sourceId}:${field.getName()}`;
      let value = model.formValues[key];
      const edit = model.importedFormEdits?.[key];
      if (edit) {
        const kind =
          field instanceof PDFTextField
            ? "text"
            : field instanceof PDFCheckBox
              ? "checkbox"
              : field instanceof PDFRadioGroup
                ? "radio"
                : field instanceof PDFDropdown
                  ? "dropdown"
                  : field instanceof PDFOptionList
                    ? "list"
                    : undefined;
        if (!kind)
          throw Error("この種類の既存フォームの設定編集には対応していません。");
        const checked = validateImportedFormEdit(
          {
            name: field.getName(),
            kind,
            hasExportValues:
              (field instanceof PDFDropdown ||
                field instanceof PDFOptionList) &&
              field.acroField
                .getOptions()
                .some(
                  (o) =>
                    o.value.decodeText() !==
                    (o.display ?? o.value).decodeText(),
                ),
          },
          edit,
        );
        this.edits.set(field.ref, checked);
        if (checked.required !== undefined) {
          if (checked.required) field.enableRequired();
          else field.disableRequired();
        }
        if (checked.readOnly !== undefined) {
          if (checked.readOnly) field.enableReadOnly();
          else field.disableReadOnly();
        }
        if (field instanceof PDFTextField) {
          if (checked.maxLength !== undefined) field.removeMaxLength();
          if (checked.multiline !== undefined) {
            if (checked.multiline) field.enableMultiline();
            else field.disableMultiline();
          }
        }
        if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
          if (
            checked.options !== undefined ||
            checked.choiceOptions !== undefined ||
            checked.multiSelect !== undefined
          ) {
            value = normalizeChoiceValue(
              value ?? field.getSelected(),
              checked.choiceOptions?.map((o) => o.value) ??
                checked.options ??
                field.acroField.getOptions().map((o) => o.value.decodeText()),
              checked.multiSelect ?? field.isMultiselect(),
            );
          }
          if (checked.options !== undefined) field.setOptions(checked.options);
          if (checked.choiceOptions !== undefined)
            field.acroField.setOptions(
              checked.choiceOptions.map((o) => ({
                value: PDFHexString.fromText(o.value),
                display: PDFHexString.fromText(o.label),
              })),
            );
          if (checked.multiSelect !== undefined) {
            if (checked.multiSelect) field.enableMultiselect();
            else field.disableMultiselect();
          }
        }
        if (
          checked.options !== undefined ||
          checked.choiceOptions !== undefined ||
          checked.multiSelect !== undefined
        )
          form.markFieldAsDirty(field.ref);
      }
      if (value !== undefined) setFieldValue(field, value);
      if (edit?.maxLength !== undefined && field instanceof PDFTextField)
        field.setMaxLength(edit.maxLength ?? undefined);
    }
    if (fields.length) {
      this.input.registerFontkit(fontkit);
      const font = fontBytes
        ? await this.input.embedFont(fontBytes, { subset: false })
        : await this.input.embedFont(StandardFonts.Helvetica);
      for (const field of fields) {
        if (
          (field instanceof PDFDropdown || field instanceof PDFOptionList) &&
          field.needsAppearancesUpdate()
        ) {
          const labels = new Map(
            field.acroField
              .getOptions()
              .map((o) => [
                o.value.decodeText(),
                (o.display ?? o.value).decodeText(),
              ]),
          );
          // Supply display text to the appearance provider without changing stored /V or selection indices.
          const displayField = new Proxy(field, {
            get(target, key, receiver) {
              if (key === "getSelected")
                return () =>
                  target.getSelected().map((v) => labels.get(v) ?? v);
              return Reflect.get(target, key, receiver);
            },
          });
          if (field instanceof PDFDropdown)
            field.updateAppearances(font, (_, widget, embeddedFont) =>
              defaultDropdownAppearanceProvider(
                displayField as PDFDropdown,
                widget,
                embeddedFont,
              ),
            );
          else
            field.updateAppearances(font, (_, widget, embeddedFont) =>
              defaultOptionListAppearanceProvider(
                displayField as PDFOptionList,
                widget,
                embeddedFont,
              ),
            );
        }
      }
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
        const edit = this.edits.get(field.ref);
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
          if (key === "DV" && value && edit) {
            if (
              field instanceof PDFTextField &&
              edit.maxLength !== undefined &&
              edit.maxLength !== null &&
              (value instanceof PDFString || value instanceof PDFHexString) &&
              value.decodeText().length > edit.maxLength
            )
              continue;
            if (
              (field instanceof PDFDropdown ||
                field instanceof PDFOptionList) &&
              (edit.options !== undefined ||
                edit.choiceOptions !== undefined ||
                edit.multiSelect !== undefined)
            ) {
              const values = (
                value instanceof PDFArray ? value.asArray() : [value]
              )
                .map((v) => this.input.context.lookup(v))
                .filter(
                  (v): v is PDFString | PDFHexString =>
                    v instanceof PDFString || v instanceof PDFHexString,
                )
                .map((v) => v.decodeText());
              const normalized = normalizeChoiceValue(
                values,
                field.acroField.getOptions().map((o) => o.value.decodeText()),
                field.isMultiselect(),
              );
              if (Array.isArray(normalized) ? normalized.length : normalized) {
                dict.set(
                  PDFName.of("DV"),
                  Array.isArray(normalized)
                    ? context.obj(
                        normalized.map((v) => PDFHexString.fromText(v)),
                      )
                    : PDFHexString.fromText(String(normalized)),
                );
              }
              continue;
            }
          }
          if (value) dict.set(PDFName.of(key), this.copier.copy(value));
        }
        const name = uniqueFieldName(edit?.name ?? field.getName(), this.names);
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
