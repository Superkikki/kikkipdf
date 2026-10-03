import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractImagePdf } from "../export/client";
import {
  uid,
  type DocumentModel,
  type EditObject,
  type ImageAsset,
} from "../state/model";

/** Copy image pixels alone at native resolution, with transparency, independently of its original PDF. */
export async function extractImageAsset(
  model: DocumentModel,
  object: EditObject,
  signal?: AbortSignal,
): Promise<ImageAsset> {
  if (object.imageDeleted)
    throw Error("削除した画像はコピーできません。先に元に戻してください。");
  if (object.imageId) {
    const asset = model.images[object.imageId];
    if (!asset) throw Error("画像データが見つかりません。");
    return { ...asset, id: uid(), bytes: asset.bytes.slice() };
  }
  const reference = object.sourceImage;
  const source = reference && model.sources[reference.sourceId];
  if (!reference || !source) throw Error("画像の参照元が見つかりません。");
  const bytes = await extractImagePdf(source.bytes, reference, signal);
  if (signal?.aborted) throw new DOMException("キャンセル", "AbortError");
  const loading = getDocument({
    data: bytes,
    wasmUrl: "/assets/pdfjs/wasm/",
    standardFontDataUrl: "/assets/pdfjs/standard_fonts/",
  });
  let canvas: HTMLCanvasElement | undefined;
  const abort = () => {
    void loading.destroy();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await loading.promise,
      page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d", { alpha: true })!, viewport, background: "rgba(0,0,0,0)" })
      .promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas!.toBlob(
        (b) => (b ? resolve(b) : reject(Error("画像を書き出せません。"))),
        "image/png",
      ),
    );
    if (blob.size > 32 * 1024 * 1024)
      throw Error("取り出すPNGは32MBまでです。");
    const data = new Uint8Array(await blob.arrayBuffer());
    if (signal?.aborted) throw new DOMException("キャンセル", "AbortError");
    return { id: uid(), bytes: data, mime: "image/png" };
  } catch (error) {
    if (signal?.aborted) throw new DOMException("キャンセル", "AbortError");
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    await loading.destroy();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
