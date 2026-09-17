import { writeMarkup } from "../annotations/pdfMarkup";
import { AttachmentWriter } from "../attachments/pdfAttachments";
import { writeLinks } from "../links/pdfLinks";
import { PageCopier } from "./pageCopy";
import { writeBookmarks } from "./bookmarks";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  pushGraphicsState,
  popGraphicsState,
  translate,
  scale as scaleCoordinates,
  rotateRadians,
  PDFName,
  PDFHexString,
  PDFArray,
  type PDFFont,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
  type PDFPage,
} from "pdf-lib";
import { FormTransfer, createFormField } from "../forms/pdfForms";
import { APP_NAME } from "../config";
import fontkit from "@pdf-lib/fontkit";
import type { DocumentModel, EditObject } from "../state/model";
export interface ExportOptions {
  indices?: number[];
}
export function color(hex: string) {
  const s = hex.replace("#", "");
  return rgb(
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  );
}
export async function exportPdf(
  model: DocumentModel,
  fontBytes?: Uint8Array,
  options: ExportOptions = {},
  progress: (v: number) => void = () => {},
): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);
  const fonts = new Map<string, PDFFont>();
  const fontFor = async (o: EditObject) => {
    const key = `${o.font}-${o.bold}-${o.italic}`;
    let f = fonts.get(key);
    if (!f) {
      if (o.font === "japanese") {
        if (!fontBytes)
          throw Error(
            "日本語フォントが見つかりません。npm run assets を実行してください。",
          );
        f = await output.embedFont(fontBytes, { subset: true });
      } else {
        const family =
          o.font === "serif"
            ? "Times"
            : o.font === "mono"
              ? "Courier"
              : "Helvetica";
        const name =
          family === "Times"
            ? o.bold
              ? o.italic
                ? "Times-BoldItalic"
                : "Times-Bold"
              : o.italic
                ? "Times-Italic"
                : "Times-Roman"
            : family +
              (o.bold
                ? o.italic
                  ? "-BoldOblique"
                  : "-Bold"
                : o.italic
                  ? "-Oblique"
                  : "");
        f = await output.embedFont(name as StandardFonts);
      }
      fonts.set(key, f);
    }
    return f;
  };
  const copiers = new Map<string, PageCopier>();
  const attachments = new AttachmentWriter(
    output,
    model,
    options.indices === undefined,
  );
  const transfers = new Map<string, FormTransfer>();
  const names = new Set<string>();
  let formFont: PDFFont | undefined;
  const getFormFont = async () =>
    (formFont ??= await output.embedFont(fontBytes ?? StandardFonts.Helvetica, {
      subset: false,
    }));
  for (const source of Object.values(model.sources)) {
    const input = await PDFDocument.load(source.bytes);
    attachments.prepare(input, source.id);
    if (input.catalog.getAcroForm()?.dict.has(PDFName.of("XFA")))
      throw Error(
        "XFAフォームには対応していません。標準AcroFormのPDFを使用してください。",
      );
    if (input.getForm().getFields().length) {
      const transfer = new FormTransfer(
        input,
        output,
        names,
        await getFormFont(),
      );
      await transfer.prepare(model, source.id, fontBytes);
      transfers.set(source.id, transfer);
    }
    await input.flush();
    copiers.set(source.id, new PageCopier(input, output, attachments));
  }
  const indices = options.indices ?? model.pages.map((_, i) => i);
  const pageMap = new Map<string, PDFPage>();
  for (let n = 0; n < indices.length; n++) {
    const p = model.pages[indices[n]];
    let page: PDFPage;
    if (p.sourceId) {
      const copier = copiers.get(p.sourceId);
      if (!copier) throw Error("参照元のPDFが見つかりません。");
      page = copier.copy(p);
    } else page = output.addPage([p.width, p.height]);
    if (!pageMap.has(p.id)) pageMap.set(p.id, page);
    if (p.sourceId) transfers.get(p.sourceId)?.attach(p.sourceIndex, page);
    for (const field of model.formFields ?? []) {
      if (field.pageId === p.id)
        createFormField(output, field, page, p, await getFormFont(), names);
    }
    const base = page.getCropBox();
    page.setRotation(degrees(p.rotation));
    const px = (x: number) => base.x + x,
      py = (y: number) => base.y + p.height - y;
    for (const o of p.objects) {
      if (o.kind === "redaction" || o.kind === "link") continue;
      if (["highlight", "underline", "strike", "ink"].includes(o.kind)) {
        writeMarkup(output, page, o, base.x, base.y + p.height);
        continue;
      }
      const c = color(o.color),
        fill = o.fill === "none" ? undefined : color(o.fill);
      const x = px(o.x),
        y = py(o.y + o.height);
      if (["text", "replacement", "ocr"].includes(o.kind)) {
        if (o.kind === "replacement")
          page.drawRectangle({
            x,
            y,
            width: o.width,
            height: o.height,
            color: fill ?? rgb(1, 1, 1),
          });
        page.pushOperators(
          pushGraphicsState(),
          translate(x, y),
          rotateRadians((-o.rotation * Math.PI) / 180),
          translate(-x, -y),
        );
        const font = await fontFor(o);
        const lines = (o.text ?? "").split("\n");
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          const width = font.widthOfTextAtSize(line, o.fontSize);
          const fitOcr = o.kind === "ocr" && width > 0;
          if (fitOcr)
            page.pushOperators(
              pushGraphicsState(),
              translate(x, 0),
              scaleCoordinates(o.width / width, 1),
              translate(-x, 0),
            );
          const dx =
            o.kind === "ocr"
              ? 0
              : o.align === "center"
                ? (o.width - width) / 2
                : o.align === "right"
                  ? o.width - width
                  : 0;
          const textOptions = {
            x: x + dx,
            y: py(o.y + o.fontSize + li * o.fontSize * 1.25),
            size: o.fontSize,
            font,
            color: c,
            opacity: o.kind === "ocr" ? 0 : o.opacity,
            xSkew: degrees(o.font === "japanese" && o.italic ? 12 : 0),
          };
          page.drawText(line, textOptions);
          if (o.font === "japanese" && o.bold)
            page.drawText(line, {
              ...textOptions,
              x: textOptions.x + o.fontSize * 0.025,
            });
          if (fitOcr) page.pushOperators(popGraphicsState());
        }
        page.pushOperators(popGraphicsState());
      } else if (o.kind === "image" && o.imageId) {
        const asset = model.images[o.imageId];
        if (!asset) throw Error("画像データが見つかりません。");
        const img =
          asset.mime === "image/png"
            ? await output.embedPng(asset.bytes)
            : await output.embedJpg(asset.bytes);
        page.drawImage(img, {
          x,
          y,
          width: o.width,
          height: o.height,
          rotate: degrees(-o.rotation),
          opacity: o.opacity,
        });
      } else if (o.kind === "ellipse") {
        page.drawEllipse({
          x: x + o.width / 2,
          y: y + o.height / 2,
          xScale: o.width / 2,
          yScale: o.height / 2,
          color: fill,
          borderColor: c,
          borderWidth: o.strokeWidth,
          opacity: o.opacity,
          borderOpacity: o.opacity,
        });
      } else if (o.kind === "note") {
        const annotation = output.context.obj({
          Type: "Annot",
          Subtype: "Text",
          Rect: [x, y, x + 24, y + 24],
          Contents: PDFHexString.fromText(o.text ?? ""),
          Name: "Comment",
          C: [1, 0.8, 0.2],
          F: 4,
        });
        const ref = output.context.register(annotation);
        let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
        if (!annots) {
          annots = output.context.obj([]);
          page.node.set(PDFName.of("Annots"), annots);
        }
        annots.push(ref);
      } else if (o.kind === "ink" && o.points) {
        for (let i = 1; i < o.points.length; i++)
          page.drawLine({
            start: {
              x: px(o.x + o.points[i - 1].x),
              y: py(o.y + o.points[i - 1].y),
            },
            end: { x: px(o.x + o.points[i].x), y: py(o.y + o.points[i].y) },
            thickness: o.strokeWidth,
            color: c,
            opacity: o.opacity,
          });
      } else if (["line", "arrow", "underline", "strike"].includes(o.kind)) {
        const start = { x, y: o.kind === "strike" ? y + o.height / 2 : y };
        const end = {
          x: x + o.width,
          y: o.kind === "line" || o.kind === "arrow" ? y + o.height : start.y,
        };
        page.drawLine({
          start,
          end,
          thickness: o.strokeWidth,
          color: c,
          opacity: o.opacity,
        });
        if (o.kind === "arrow") {
          const a = Math.atan2(end.y - start.y, end.x - start.x);
          for (const offset of [-0.5, 0.5])
            page.drawLine({
              start: end,
              end: {
                x: end.x - 12 * Math.cos(a + offset),
                y: end.y - 12 * Math.sin(a + offset),
              },
              thickness: o.strokeWidth,
              color: c,
            });
        }
      } else
        page.drawRectangle({
          x,
          y,
          width: o.width,
          height: o.height,
          color: fill ?? (o.kind === "highlight" ? c : undefined),
          borderColor: o.kind === "highlight" ? undefined : c,
          borderWidth: o.kind === "highlight" ? 0 : o.strokeWidth,
          opacity: o.opacity,
          borderOpacity: o.opacity,
        });
    }
    if (p.crop)
      page.setCropBox(
        px(p.crop.x),
        py(p.crop.y + p.crop.height),
        p.crop.width,
        p.crop.height,
      );
    progress((n + 1) / indices.length);
  }
  for (const copier of copiers.values()) copier.finish(pageMap);
  writeLinks(output, model, pageMap);
  writeBookmarks(output, model.bookmarks ?? [], pageMap);
  attachments.finish();
  output.setTitle(model.metadata.title);
  output.setAuthor(model.metadata.author);
  output.setSubject(model.metadata.subject);
  output.setKeywords(model.metadata.keywords.split(",").map((s) => s.trim()));
  output.setProducer(`${APP_NAME} / pdf-lib`);
  if (formFont) {
    output
      .getForm()
      .acroForm.dict.set(
        PDFName.of("DR"),
        output.context.obj({ Font: { KikkiForm: formFont.ref } }),
      );
    if (model.flattenForms)
      output.getForm().flatten({ updateFieldAppearances: false });
  }
  return output.save({ updateFieldAppearances: false });
}
export interface FormDescriptor {
  key: string;
  name: string;
  kind: "text" | "checkbox" | "radio" | "dropdown" | "list";
  value: string | boolean | string[];
  options: string[];
  readOnly?: boolean;
  multiline?: boolean;
  multiSelect?: boolean;
  maxLength?: number;
}
export async function inspectForms(
  model: Pick<DocumentModel, "sources">,
): Promise<FormDescriptor[]> {
  const result: FormDescriptor[] = [];
  for (const s of Object.values(model.sources)) {
    const doc = await PDFDocument.load(s.bytes);
    if (doc.catalog.getAcroForm()?.dict.has(PDFName.of("XFA")))
      throw Error("XFAフォームは未対応です。");
    for (const f of doc.getForm().getFields()) {
      const base = {
        key: `${s.id}:${f.getName()}`,
        name: f.getName(),
        readOnly: f.isReadOnly(),
        options: [] as string[],
      };
      if (f instanceof PDFTextField)
        result.push({
          ...base,
          kind: "text",
          value: f.getText() ?? "",
          multiline: f.isMultiline(),
          maxLength: f.getMaxLength(),
        });
      if (f instanceof PDFCheckBox)
        result.push({ ...base, kind: "checkbox", value: f.isChecked() });
      if (f instanceof PDFRadioGroup)
        result.push({
          ...base,
          kind: "radio",
          value: f.getSelected() ?? "",
          options: f.getOptions(),
        });
      if (f instanceof PDFDropdown || f instanceof PDFOptionList)
        result.push({
          ...base,
          kind: f instanceof PDFDropdown ? "dropdown" : "list",
          multiSelect: f.isMultiselect(),
          value: f.getSelected(),
          options: f.getOptions(),
        });
    }
  }
  return result;
}
/** Fresh image-only document is the destructive redaction boundary: no source PDF objects are copied. */
export async function imagesToPdf(
  images: { bytes: Uint8Array; width: number; height: number; mime: string }[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const image of images) {
    const p = doc.addPage([image.width, image.height]);
    const embedded =
      image.mime === "image/jpeg"
        ? await doc.embedJpg(image.bytes)
        : await doc.embedPng(image.bytes);
    p.drawImage(embedded, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
  }
  doc.setProducer(APP_NAME);
  return doc.save();
}
export function pdfVersion(bytes: Uint8Array) {
  return (
    new TextDecoder()
      .decode(bytes.subarray(0, 12))
      .match(/%PDF-([\d.]+)/)?.[1] ?? "—"
  );
}
