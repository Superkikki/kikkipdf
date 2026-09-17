import { withAbort } from "../commands/abort";
import { createWorker } from "tesseract.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { exportDocument } from "../export/client";
import { newObject, type DocumentModel, type EditObject } from "../state/model";
export async function recognize(
  model: DocumentModel,
  indices: number[],
  language: string,
  progress: (v: number, label: string) => void,
  signal: AbortSignal,
): Promise<Map<string, EditObject[]>> {
  const results = new Map<string, EditObject[]>();
  let pageIndex = 0;
  const creating = createWorker(language, 1, {
    workerPath: "/assets/ocr/worker.min.js",
    corePath: "/assets/ocr/",
    langPath: "/assets/ocr/",
    gzip: false,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === "recognizing text")
        progress(
          (pageIndex + m.progress) / indices.length,
          `OCR ${pageIndex + 1} / ${indices.length}`,
        );
    },
  });
  void creating
    .then((w) => {
      if (signal.aborted) void w.terminate();
    })
    .catch(() => {});
  const worker = await withAbort(creating, signal);
  const cancel = () => {
    void worker.terminate();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new DOMException("キャンセル", "AbortError");
    for (pageIndex = 0; pageIndex < indices.length; pageIndex++) {
      if (signal.aborted) throw new DOMException("キャンセル", "AbortError");
      const page = model.pages[indices[pageIndex]];
      // Work in unrotated page coordinates so OCR objects remain correct after rotations and crop changes.
      const single = {
        ...model,
        flattenForms: true,
        pages: [
          {
            ...page,
            rotation: 0,
            crop: undefined,
            objects: page.objects.filter((o) => o.kind !== "ocr"),
          },
        ],
      };
      const bytes = await exportDocument(single, undefined, signal, [0]);
      const pdf = await getDocument({ data: bytes }).promise;
      const canvas = document.createElement("canvas");
      try {
        const p = await pdf.getPage(1);
        const scale = Math.min(
          2,
          Math.sqrt(16_000_000 / (page.width * page.height)),
        );
        const viewport = p.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const render = p.render({ canvas, viewport });
        const cancelRender = () => render.cancel();
        signal.addEventListener("abort", cancelRender, { once: true });
        try {
          await withAbort(render.promise, signal);
        } finally {
          signal.removeEventListener("abort", cancelRender);
        }
        const result = await withAbort(
          worker.recognize(canvas, {}, { blocks: true, text: true }),
          signal,
        );
        const objects: EditObject[] = [];
        for (const block of result.data.blocks ?? [])
          for (const paragraph of block.paragraphs)
            for (const line of paragraph.lines) {
              const { x0, y0, x1, y1 } = line.bbox;
              if (x1 <= x0 || y1 <= y0 || !line.text.trim()) continue;
              objects.push({
                ...newObject("ocr", x0 / scale, y0 / scale),
                width: (x1 - x0) / scale,
                height: (y1 - y0) / scale,
                fontSize: ((y1 - y0) / scale) * 0.85,
                text: line.text.trimEnd(),
                opacity: 0,
                ocrConfidence: Number.isFinite(line.confidence)
                  ? Math.max(0, Math.min(100, line.confidence))
                  : undefined,
                ocrReviewed: false,
              });
            }
        results.set(page.id, objects);
      } finally {
        canvas.width = canvas.height = 0;
        await pdf.loadingTask.destroy();
      }
    }
    return results;
  } finally {
    signal.removeEventListener("abort", cancel);
    await worker.terminate();
  }
}
