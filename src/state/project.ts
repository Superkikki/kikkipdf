import { z } from "zod";
import {
  importedFormEditSchema,
  resolveImportedForm,
  validateImportedFormEdit,
} from "../forms/importedSettings";
import { inspectForms } from "../export/engine";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { BookmarkModel, DocumentModel } from "./model";
import { inspectFont } from "../fonts/inspect";
import { checkFontBudget, MAX_FONT_BYTES } from "../fonts/budget";
import { directReferences, directImageEdits } from "../direct/model";
import { bookmarkDestinationSchema } from "../pages/bookmarkDestination";
import { validPageLabel, MAX_PAGE_LABEL_LENGTH } from "../pages/labels";
import { importedMarkupsSchema } from "../annotations/importedMarkup";

const id = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => !["__proto__", "prototype", "constructor"].includes(s));
const text = z.string().max(1_000_000),
  number = z.number().finite();
const box = {
  x: number.min(-1e6).max(1e6),
  y: number.min(-1e6).max(1e6),
  width: number.positive().max(100000),
  height: number.positive().max(100000),
};
const color = z.string().regex(/^#[\da-f]{6}$/i);
const value = z.union([text, z.boolean(), z.array(text).max(10000)]);
const reviewStatus = z.enum(["None", "Accepted", "Rejected", "Cancelled", "Completed"]);
const linkTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), pageId: id }),
  z.object({ kind: z.literal("url"), url: z.string().max(8192) }),
]);
const bookmark: z.ZodType<BookmarkModel> = z.lazy(() =>
  z.object({
    id,
    title: text,
    pageId: id.optional(),
    destination: bookmarkDestinationSchema.optional(),
    url: z.string().max(8192).optional(),
    expanded: z.boolean().optional(),
    color: color.optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    children: z.array(bookmark).max(10000),
  }).refine((b) => b.pageId === undefined || b.url === undefined, {
    message: "しおりの移動先はページかURLのいずれかにしてください。",
  }).refine((b) => b.destination === undefined || b.pageId !== undefined, {
    message: "しおりのページ内移動先にはページが必要です。",
  }),
);
const object = z.object({
  ...box,
  id,
  kind: z.enum([
    "direct-text",
    "direct-image",
    "text",
    "image",
    "rect",
    "ellipse",
    "line",
    "arrow",
    "ink",
    "highlight",
    "underline",
    "strike",
    "note",
    "redaction",
    "replacement",
    "ocr",
    "link",
  ]),
  color,
  fill: z.union([color, z.literal("none")]),
  opacity: number.min(0).max(1),
  strokeWidth: number.min(0).max(1000),
  textStrokeWidth: number.min(0).max(1000).optional(),
  textStrokeColor: color.optional(),
  textOutlineOnly: z.boolean().optional(),
  text: text.optional(),
  author: z.string().max(10000).optional(),
  reviewStatus: reviewStatus.optional(),
  fontSize: number.positive().max(10000),
  font: z.enum(["sans", "serif", "mono", "japanese", "custom"]),
  fontId: z
    .string()
    .regex(/^font-[a-f0-9]{64}$/)
    .optional(),
  sourceText: z
    .object({
      sourceId: id,
      sourceIndex: z.number().int().min(0).max(100000),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      operatorIndex: z.number().int().min(0).max(200000),
      originalText: text,
      formPath: z.array(z.number().int().min(0).max(200000)).min(1).max(16).optional(),
      additional: z
        .array(
          z.object({
            sourceIndex: z.number().int().min(0).max(100000),
            contentHash: z.string().regex(/^[a-f0-9]{64}$/),
            operatorIndex: z.number().int().min(0).max(200000),
            originalText: text,
            formPath: z.array(z.number().int().min(0).max(200000)).min(1).max(16).optional(),
          }),
        )
        .max(200000)
        .optional(),
    })
    .optional(),
  sourceImage: z.object({
    sourceId: id, sourceIndex: z.number().int().min(0).max(100000),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/), operatorIndex: z.number().int().min(0).max(200000),
    formPath: z.array(z.number().int().min(0).max(200000)).min(1).max(16).optional(),
    resourceName: z.string().min(1).max(1000), originalBox: z.object(box),
    bounds: z.array(z.object(box)).max(16).optional(),
  }).optional(),
  imageDeleted: z.boolean().optional(),
  bold: z.boolean(),
  italic: z.boolean(),
  align: z.enum(["left", "center", "right"]),
  rotation: number.min(-36000).max(36000),
  imageId: id.optional(),
  link: linkTarget.optional(),
  ocrConfidence: number.min(0).max(100).optional(),
  ocrReviewed: z.boolean().optional(),
  wrap: z.boolean().optional(),
  writingMode: z.literal("vertical").optional(),
  lineHeight: number.min(1).max(3).optional(),
  points: z
    .array(z.object({ x: number, y: number }))
    .max(100000)
    .optional(),
});
const asset = {
  id,
  name: z.string().max(1000),
  file: z.string().regex(/^(sources|images|attachments)\/\d+\.(pdf|bin)$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
};
const schema = z.object({
  format: z.literal("kikki-pdf-project"),
  version: z.literal(1),
  document: z.object({
    id,
    name: z.string().min(1).max(1000),
    created: number,
    sources: z.record(id, z.object({ ...asset,
      layerNames: z.record(z.string().regex(/^[1-9]\d*R(?:[1-9]\d*)?$/), z.string().min(1).max(1000).refine(value => !!value.trim()))
        .refine(items => Object.keys(items).length <= 10000).optional(),
      layerVisibility: z.record(z.string().regex(/^[1-9]\d*R(?:[1-9]\d*)?$/), z.boolean())
        .refine((items) => Object.keys(items).length <= 10000).optional(),
    })),
    images: z.record(
      id,
      z.object({ ...asset, mime: z.enum(["image/png", "image/jpeg"]) }),
    ),
    fonts: z
      .record(
        id,
        z.object({
          id,
          name: z.string().max(1000),
          family: z.string().max(1000),
          format: z.enum(["ttf", "otf"]),
          file: z.string().regex(/^fonts\/\d+\.(ttf|otf)$/),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .optional(),
    attachments: z
      .array(z.object({ ...asset, description: text }))
      .max(10000)
      .optional(),
    attachmentEdits: z
      .record(
        z.string().max(500),
        z.object({
          name: z.string().max(1000).optional(),
          description: text.optional(),
          deleted: z.boolean().optional(),
        }),
      )
      .optional(),
    pages: z
      .array(
        z.object({
          id,
          sourceId: id.optional(),
          sourceIndex: z.number().int().min(0).max(100000),
          label: z.string().max(MAX_PAGE_LABEL_LENGTH).refine(validPageLabel).optional(),
          width: box.width,
          height: box.height,
          rotation: z.union([
            z.literal(0),
            z.literal(90),
            z.literal(180),
            z.literal(270),
          ]),
          objects: z.array(object).max(100000),
          importedMarkups: importedMarkupsSchema.optional(),
          annotationEdits: z
            .record(
              z.string(),
              z.object({
                text: text.optional(),
                author: z.string().max(10000).optional(),
                reviewStatus: reviewStatus.optional(),
                deleted: z.boolean().optional(),
                link: linkTarget.optional(),
                box: z.object(box).optional(),
              }),
            )
            .optional(),
          crop: z.object(box).optional(),
          formWidgetEdits: z
            .record(z.string().max(1200), z.object(box))
            .optional(),
        }),
      )
      .min(1)
      .max(10000),
    metadata: z.object({
      title: text,
      author: text,
      subject: text,
      keywords: text,
    }),
    formValues: z.record(z.string(), value),
    importedFormEdits: z
      .record(z.string().max(1500), importedFormEditSchema)
      .optional(),
    formFields: z
      .array(
        z.object({
          ...box,
          id,
          pageId: id,
          name: z.string().min(1).max(500),
          kind: z.enum(["text", "checkbox", "radio", "dropdown", "list"]),
          value,
          options: z.array(text).max(10000),
          fontSize: number.positive().max(1000),
          required: z.boolean(),
          readOnly: z.boolean(),
          multiline: z.boolean(),
          multiSelect: z.boolean().optional(),
          maxLength: z.number().int().min(1).max(1000000).optional(),
        }),
      )
      .max(10000)
      .optional(),
    flattenForms: z.boolean().optional(),
    bookmarks: z.array(bookmark).max(10000).optional(),
  }),
});
const MAX_BYTES = 512 * 1024 * 1024;
const hash = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Self-contained editable document, with no native paths or passwords. Runs in the export Worker. */
export async function saveProject(model: DocumentModel): Promise<Uint8Array> {
  await checkImportedFormSettings(model);
  checkFontBudget(model.fonts ?? {});
  for (const page of model.pages) { directReferences(page); directImageEdits(page); }
  const files: Record<string, Uint8Array> = {},
    sources: Record<
      string,
      z.infer<typeof schema>["document"]["sources"][string]
    > = {},
    images: Record<
      string,
      z.infer<typeof schema>["document"]["images"][string]
    > = {};
  const attachments: NonNullable<
    z.infer<typeof schema>["document"]["attachments"]
  > = [];
  const fonts: NonNullable<z.infer<typeof schema>["document"]["fonts"]> = {};
  let total = 0;
  for (const [i, f] of Object.values(model.fonts ?? {}).entries()) {
    const checked = await inspectFont(f.bytes, f.name);
    if (checked.id !== f.id) throw Error("フォントの整合性エラー");
    const file = `fonts/${i}.${checked.format}`;
    files[file] = f.bytes;
    total += f.bytes.length;
    fonts[f.id] = {
      id: f.id,
      name: checked.name,
      family: checked.family,
      format: checked.format,
      file,
      sha256: f.id.slice(5),
    };
  }
  for (const p of model.pages)
    for (const o of p.objects)
      if (o.font === "custom" && (!o.fontId || !fonts[o.fontId]))
        throw Error("参照フォントがありません。");
  for (const [i, s] of Object.values(model.sources).entries()) {
    const file = `sources/${i}.pdf`;
    files[file] = s.bytes;
    total += s.bytes.length;
    sources[s.id] = {
      id: s.id,
      name: s.name,
      file,
      sha256: await hash(s.bytes),
      layerVisibility: s.layerVisibility,
      layerNames: s.layerNames,
    };
  }
  for (const [i, s] of Object.values(model.images).entries()) {
    const file = `images/${i}.bin`;
    files[file] = s.bytes;
    total += s.bytes.length;
    images[s.id] = {
      id: s.id,
      name: s.id,
      file,
      sha256: await hash(s.bytes),
      mime: s.mime,
    };
  }
  for (const [i, a] of (model.attachments ?? []).entries()) {
    const file = `attachments/${i}.bin`;
    if (a.bytes.length > 128 * 1024 * 1024)
      throw Error("添付ファイルは1件128MBまで対応しています。");
    files[file] = a.bytes;
    total += a.bytes.length;
    attachments.push({
      id: a.id,
      name: a.name,
      description: a.description,
      file,
      sha256: await hash(a.bytes),
    });
  }
  if (total > MAX_BYTES)
    throw Error("編集プロジェクトは展開後512MBまで対応しています。");
  const manifest = schema.parse({
    format: "kikki-pdf-project",
    version: 1,
    document: { ...model, sources, images, attachments, fonts },
  });
  files["document.json"] = strToU8(JSON.stringify(manifest));
  return zipSync(files, { level: 1 });
}

export async function openProject(bytes: Uint8Array): Promise<DocumentModel> {
  try {
    let total = 0,
      count = 0,
      fontCount = 0,
      fontTotal = 0;
    const names = new Set<string>();
    const files = unzipSync(bytes, {
      filter(file) {
        if (
          ++count > 20000 ||
          names.has(file.name) ||
          !(
            /^(sources|images|attachments)\/\d+\.(pdf|bin)$/.test(file.name) ||
            /^fonts\/\d+\.(ttf|otf)$/.test(file.name) ||
            file.name === "document.json"
          )
        )
          throw Error("不正なアーカイブ項目");
        names.add(file.name);
        if (file.name.startsWith("fonts/")) {
          fontTotal += file.originalSize;
          if (
            ++fontCount > 32 ||
            file.originalSize > MAX_FONT_BYTES ||
            fontTotal > 128 * 1024 * 1024
          )
            throw Error("フォントのサイズ上限を超えています");
        }
        total += file.originalSize;
        if (
          total > MAX_BYTES ||
          (file.name === "document.json" &&
            file.originalSize > 16 * 1024 * 1024)
        )
          throw Error("サイズ上限を超えています");
        return true;
      },
    });
    if (!files["document.json"]) throw Error("文書情報がありません");
    const raw: unknown = JSON.parse(strFromU8(files["document.json"]));
    const queue: { v: unknown; depth: number }[] = [{ v: raw, depth: 0 }];
    let nodes = 0;
    while (queue.length) {
      const { v, depth } = queue.pop()!;
      if (++nodes > 500000 || depth > 64) throw Error("文書構造が複雑すぎます");
      if (v && typeof v === "object")
        for (const child of Object.values(v))
          queue.push({ v: child, depth: depth + 1 });
    }
    const { document: d } = schema.parse(raw);
    const model: DocumentModel = {
      ...d,
      sources: {},
      images: {},
      fonts: {},
      attachments: [],
    };
    for (const [key, f] of Object.entries(d.fonts ?? {})) {
      const data = files[f.file];
      if (!data || key !== f.id || key !== `font-${f.sha256}`)
        throw Error("フォントの整合性エラー");
      const asset = await inspectFont(data, f.name);
      if (asset.id !== key || asset.format !== f.format)
        throw Error("フォントの整合性エラー");
      model.fonts![key] = asset;
    }
    checkFontBudget(model.fonts!);
    for (const [key, s] of Object.entries(d.sources)) {
      const data = files[s.file];
      if (key !== s.id || !data || (await hash(data)) !== s.sha256)
        throw Error("元PDFの整合性エラー");
      model.sources[key] = { id: s.id, name: s.name, bytes: data, layerVisibility: s.layerVisibility, layerNames: s.layerNames };
    }
    for (const [key, s] of Object.entries(d.images)) {
      const data = files[s.file];
      if (key !== s.id || !data || (await hash(data)) !== s.sha256)
        throw Error("画像の整合性エラー");
      model.images[key] = { id: s.id, mime: s.mime, bytes: data };
    }
    const attachmentIds = new Set<string>();
    for (const a of d.attachments ?? []) {
      const data = files[a.file];
      if (
        !data ||
        data.length > 128 * 1024 * 1024 ||
        (await hash(data)) !== a.sha256 ||
        attachmentIds.has(a.id)
      )
        throw Error("添付ファイルの整合性エラー");
      attachmentIds.add(a.id);
      model.attachments!.push({
        id: a.id,
        name: a.name,
        description: a.description,
        bytes: data,
      });
    }
    const pages = new Set(model.pages.map((p) => p.id));
    if (pages.size !== model.pages.length)
      throw Error("ページIDが重複しています");
    for (const page of model.pages) {
      directReferences(page);
      directImageEdits(page);
      if (page.sourceId && !model.sources[page.sourceId])
        throw Error("参照元PDFがありません");
      for (const o of page.objects) {
        if (
          o.kind === "direct-text" &&
          (!o.sourceText ||
            o.sourceText.sourceId !== page.sourceId ||
            o.sourceText.sourceIndex !== page.sourceIndex)
        )
          throw Error("直接編集の参照先が不正です");
        if (o.imageId && !model.images[o.imageId])
          throw Error("参照画像がありません");
        if (o.font === "custom" && (!o.fontId || !model.fonts?.[o.fontId]))
          throw Error("参照フォントがありません");
      }
    }
    if (model.formFields?.some((f) => !pages.has(f.pageId)))
      throw Error("フォームの配置ページがありません");
    await checkImportedFormSettings(model);
    // Native paths from the archive are intentionally not part of the schema.
    return model;
  } catch (error) {
    throw Error(
      error instanceof z.ZodError
        ? "編集プロジェクトの形式またはバージョンが不正です。"
        : `編集プロジェクトを開けません: ${error instanceof Error ? error.message : "データが不正です"}`,
    );
  }
}

async function checkImportedFormSettings(model: DocumentModel) {
  const edits = Object.entries(model.importedFormEdits ?? {});
  if (!edits.length) return;
  const fields = new Map((await inspectForms(model)).map((f) => [f.key, f]));
  for (const [key, edit] of edits) {
    const field = fields.get(key);
    if (!field) throw Error("設定を変更した既存フォームの参照先がありません。");
    validateImportedFormEdit(field, edit);
    const resolved = resolveImportedForm(field, model);
    if (
      field.kind === "text" &&
      resolved.maxLength !== undefined &&
      String(resolved.value).length > resolved.maxLength
    )
      throw Error("既存フォームの入力値が最大文字数を超えています。");
  }
}

export const zipFiles = (files: Record<string, Uint8Array>) =>
  zipSync(files, { level: 0 });
