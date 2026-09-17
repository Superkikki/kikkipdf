import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { exportDocument, createImagePdf } from "../export/client";
import type { DocumentModel } from "../state/model";
/** Destructive raster reconstruction. Never copies source objects, metadata, attachments, OCR or annotations. */
export async function applyRedactions(
  model: DocumentModel,
  progress: (v: number) => void,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const images: {
    bytes: Uint8Array;
    width: number;
    height: number;
    mime: string;
  }[] = [];
  for (let i = 0; i < model.pages.length; i++) {
    if (signal.aborted) throw new DOMException("キャンセル", "AbortError");
    const page = model.pages[i];
    const bytes = await exportDocument(
      {
        ...model,
        flattenForms: true,
        pages: [{ ...page, rotation: 0, crop: undefined }],
      },
      undefined,
      signal,
      [0],
    );
    const pdf = await getDocument({ data: bytes }).promise;
    try {
      const p = await pdf.getPage(1);
      const scale = Math.min(
        2.5,
        Math.sqrt(20_000_000 / (page.width * page.height)),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(page.width * scale);
      canvas.height = Math.ceil(page.height * scale);
      await p.render({ canvas, viewport: p.getViewport({ scale }) }).promise;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#000";
      for (const o of page.objects.filter((o) => o.kind === "redaction")) {
        ctx.fillRect(
          Math.floor(o.x * scale) - 2,
          Math.floor(o.y * scale) - 2,
          Math.ceil(o.width * scale) + 4,
          Math.ceil(o.height * scale) + 4,
        );
      }
      const crop = page.crop ?? {
        x: 0,
        y: 0,
        width: page.width,
        height: page.height,
      };
      const rotated = page.rotation % 180 !== 0;
      const out = document.createElement("canvas");
      out.width = Math.ceil((rotated ? crop.height : crop.width) * scale);
      out.height = Math.ceil((rotated ? crop.width : crop.height) * scale);
      const c = out.getContext("2d")!;
      if (page.rotation === 90) {
        c.translate(out.width, 0);
        c.rotate(Math.PI / 2);
      } else if (page.rotation === 180) {
        c.translate(out.width, out.height);
        c.rotate(Math.PI);
      } else if (page.rotation === 270) {
        c.translate(0, out.height);
        c.rotate(-Math.PI / 2);
      }
      c.drawImage(
        canvas,
        crop.x * scale,
        crop.y * scale,
        crop.width * scale,
        crop.height * scale,
        0,
        0,
        crop.width * scale,
        crop.height * scale,
      );
      const blob = await new Promise<Blob>((resolve, reject) =>
        out.toBlob(
          (b) => (b ? resolve(b) : reject(Error("画像化に失敗しました。"))),
          "image/png",
        ),
      );
      images.push({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: rotated ? crop.height : crop.width,
        height: rotated ? crop.width : crop.height,
        mime: "image/png",
      });
      canvas.width = out.width = 0;
    } finally {
      await pdf.loadingTask.destroy();
    }
    progress((i + 1) / model.pages.length);
  }
  return createImagePdf(images);
}
