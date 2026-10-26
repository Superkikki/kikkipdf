import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict, PDFRef, PDFArray, degrees } from "pdf-lib";
import { unzlibSync, zlibSync } from "fflate";

export type CompressionPreset = "lossless" | "balanced" | "small";
export interface ProcessingOptions { compression: CompressionPreset | "none"; rotation: number; clearMetadata: boolean }
export interface OptimizationResult { bytes: Uint8Array; before: number; after: number; images: number; skippedImages: number; streams: number }
const name = (s: string) => PDFName.of(s);
const value = (dict: PDFDict, key: string) => dict.lookup(name(key));
const number = (dict: PDFDict, key: string) => { const v = value(dict, key); return v instanceof PDFNumber ? v.asNumber() : NaN; };
const isName = (dict: PDFDict, key: string, expected: string) => value(dict, key) === name(expected);
const MAX_DECODED = 64 * 1024 * 1024;

/** Bound decompression by providing a fixed output buffer; reject truncated/oversized image data. */
function imagePixels(stream: PDFRawStream, width: number, height: number, channels: number) {
  const size = width * height * channels;
  const raw = value(stream.dict, "Filter") ? unzlibSync(stream.contents, { out: new Uint8Array(size + 1) }) : stream.contents;
  if (raw.length !== size) throw Error("画像の画素数が一致しません。");
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = raw[i * channels]; rgba[i * 4 + 1] = raw[i * channels + (channels === 3 ? 1 : 0)];
    rgba[i * 4 + 2] = raw[i * channels + (channels === 3 ? 2 : 0)]; rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
async function recompressImage(stream: PDFRawStream, preset: Exclude<CompressionPreset, "lossless">): Promise<PDFRawStream | null> {
  const dict = stream.dict, w = number(dict, "Width"), h = number(dict, "Height"), filter = value(dict, "Filter");
  // Masks, calibrated/indexed/CMYK colours, decode transforms and predictors require separate treatment.
  if (![w, h].every(n => Number.isInteger(n) && n > 0) || w * h > MAX_DECODED / 4 || number(dict, "BitsPerComponent") !== 8 ||
      ["Mask", "SMask", "Decode", "DecodeParms", "ImageMask", "Alternates", "SMaskInData", "Intent"].some(key => dict.has(name(key))) ||
      ![undefined, name("FlateDecode"), name("DCTDecode")].includes(filter as PDFName | undefined) ||
      !(isName(dict, "ColorSpace", "DeviceRGB") || isName(dict, "ColorSpace", "DeviceGray"))) return null;
  if (typeof OffscreenCanvas === "undefined") return null;
  const max = preset === "small" ? 1200 : 2000, ratio = Math.min(1, max / Math.max(w, h));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w * ratio)), Math.max(1, Math.round(h * ratio)));
  const ctx = canvas.getContext("2d"); if (!ctx) return null;
  let bitmap: ImageBitmap | undefined;
  try {
    if (filter === name("DCTDecode")) {
      // PDF JPEG colour transforms outside defaults are excluded above.
      bitmap = await createImageBitmap(new Blob([new Uint8Array(stream.contents)], { type: "image/jpeg" }), { colorSpaceConversion: "none" });
      if (bitmap.width !== w || bitmap.height !== h) return null;
    } else {
      bitmap = await createImageBitmap(new ImageData(imagePixels(stream, w, h, isName(dict, "ColorSpace", "DeviceRGB") ? 3 : 1), w, h));
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: preset === "small" ? 0.65 : 0.82 })).arrayBuffer());
    if (bytes.length >= stream.contents.length) return null;
    const copy = dict.clone();
    copy.set(name("Width"), PDFNumber.of(canvas.width)); copy.set(name("Height"), PDFNumber.of(canvas.height));
    copy.set(name("Filter"), name("DCTDecode")); copy.set(name("ColorSpace"), name("DeviceRGB"));
    return PDFRawStream.of(copy, bytes);
  } finally { bitmap?.close(); canvas.width = canvas.height = 0; }
}

export async function processPdf(bytes: Uint8Array, options: ProcessingOptions, progress: (n: number) => void = () => {}): Promise<OptimizationResult> {
  if (!bytes.length || bytes.length > 256 * 1024 * 1024) throw Error("PDFは1ファイル256MBまでです。");
  if (![0, 90, 180, 270].includes(options.rotation) || !["none", "lossless", "balanced", "small"].includes(options.compression)) throw Error("処理設定が不正です。");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  // Any signature dictionary, including certification signatures, must be rejected before rewriting.
  const pending = doc.context.enumerateIndirectObjects().map(([, object]) => object), visited = new Set<unknown>();
  while (pending.length) {
    const object = pending.pop()!;
    if (visited.has(object)) continue;
    visited.add(object);
    if (visited.size > 500000) throw Error("PDFの構造が大きすぎます。");
    const dict = object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : undefined;
    if (dict) {
      if (isName(dict, "FT", "Sig") || isName(dict, "Type", "Sig") || dict.has(name("ByteRange"))) throw Error("署名欄・電子署名を含むPDFは一括処理・最適化できません。");
      for (const [, child] of dict.entries()) if (child instanceof PDFDict || child instanceof PDFArray) pending.push(child);
    } else if (object instanceof PDFArray) for (const child of object.asArray()) if (child instanceof PDFDict || child instanceof PDFArray) pending.push(child);
  }
  if (options.rotation) for (const page of doc.getPages()) page.setRotation(degrees((page.getRotation().angle + options.rotation) % 360));
  if (options.clearMetadata) {
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (info instanceof PDFDict) for (const key of info.keys()) info.delete(key);
    doc.context.trailerInfo.Info = undefined;
    const metadata = doc.catalog.get(name("Metadata"));
    if (metadata instanceof PDFRef) doc.context.assign(metadata, doc.context.flateStream(new Uint8Array()));
    doc.catalog.delete(name("Metadata"));
  }
  const transformed = options.rotation !== 0 || options.clearMetadata;
  const baseline = transformed ? await doc.save({ useObjectStreams: true, updateFieldAppearances: false }) : bytes;
  let images = 0, skippedImages = 0, streams = 0;
  const objects = doc.context.enumerateIndirectObjects();
  if (options.compression !== "none") for (let i = 0; i < objects.length; i++) {
    const [ref, object] = objects[i];
    if (object instanceof PDFRawStream) {
      if (isName(object.dict, "Subtype", "Image")) {
        let replacement: PDFRawStream | null = null;
        if (options.compression !== "lossless") {
          try { replacement = await recompressImage(object, options.compression); } catch { /* Keep unsupported or malformed images verbatim. */ }
        }
        if (replacement) { doc.context.assign(ref, replacement); images++; } else skippedImages++;
      } else if (!value(object.dict, "Filter") && object.contents.length > 256 && object.contents.length <= MAX_DECODED) {
        const compressed = zlibSync(object.contents, { level: 9 });
        if (compressed.length < object.contents.length) {
          const dict = object.dict.clone(); dict.set(name("Filter"), name("FlateDecode"));
          doc.context.assign(ref, PDFRawStream.of(dict, compressed)); streams++;
        }
      }
    }
    if (i % 20 === 0) { progress(i / Math.max(1, objects.length)); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  const output = options.compression === "none" ? baseline : await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  const smaller = output.length < baseline.length;
  progress(1);
  return { bytes: smaller ? output : baseline, before: bytes.length, after: smaller ? output.length : baseline.length,
    images: smaller ? images : 0, streams: smaller ? streams : 0, skippedImages: skippedImages + (smaller ? 0 : images) };
}
