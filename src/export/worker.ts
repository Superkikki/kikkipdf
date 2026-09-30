/// <reference lib="webworker" />
import { saveProject, openProject, zipFiles } from "../state/project";
import { exportPdf, inspectForms, imagesToPdf } from "./engine";
import type { DocumentModel } from "../state/model";
import { splitPdfZip } from "./split";
import {
  inspectAttachments,
  extractAttachment,
} from "../attachments/pdfAttachments";
export type WorkerRequest =
  | {
      id: number;
      type: "split";
      model: DocumentModel;
      indices: number[];
      groupSize: number;
    }
  | { id: number; type: "attachments"; model: Pick<DocumentModel, "sources"> }
  | {
      id: number;
      type: "attachmentExtract";
      model: Pick<DocumentModel, "sources" | "attachments">;
      attachmentId: string;
    }
  | { id: number; type: "projectSave"; model: DocumentModel }
  | { id: number; type: "projectOpen"; bytes: Uint8Array }
  | { id: number; type: "zip"; files: Record<string, Uint8Array> }
  | { id: number; type: "export"; model: DocumentModel; indices?: number[] }
  | { id: number; type: "forms"; model: Pick<DocumentModel, "sources"> }
  | { id: number; type: "images"; images: Parameters<typeof imagesToPdf>[0] };
let font: Promise<Uint8Array> | undefined;
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    let result: unknown;
    if (req.type === "export" || req.type === "split") {
      font ??= fetch("/assets/NotoSansJP-Regular.otf")
        .then((r) => {
          if (!r.ok) throw Error("ローカル日本語フォントを読み込めません。");
          return r.arrayBuffer();
        })
        .then((b) => new Uint8Array(b));
      result =
        req.type === "split"
          ? await splitPdfZip(
              req.model,
              req.indices,
              req.groupSize,
              await font,
              (progress) => postMessage({ id: req.id, progress }),
            )
          : await exportPdf(
              req.model,
              await font,
              { indices: req.indices },
              (progress) => postMessage({ id: req.id, progress }),
            );
    } else if (req.type === "attachments")
      result = await inspectAttachments(req.model);
    else if (req.type === "attachmentExtract")
      result = await extractAttachment(req.model, req.attachmentId);
    else if (req.type === "projectSave") result = await saveProject(req.model);
    else if (req.type === "projectOpen") result = await openProject(req.bytes);
    else if (req.type === "zip") result = zipFiles(req.files);
    else if (req.type === "forms") result = await inspectForms(req.model);
    else result = await imagesToPdf(req.images);
    if (result instanceof Uint8Array)
      postMessage({ id: req.id, result }, [result.buffer]);
    else postMessage({ id: req.id, result });
  } catch (error) {
    postMessage({
      id: req.id,
      error: error instanceof Error ? error.message : "PDF処理に失敗しました。",
    });
  }
};
