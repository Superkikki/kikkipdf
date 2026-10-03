import type {
  DocumentModel,
  ImageAsset,
  FontAsset,
  Source,
  PageModel,
} from "../state/model";
import type { DirectInspection, SourceImageReference } from "../direct/model";
import type { FormDescriptor, imagesToPdf } from "./engine";
import type { WorkerRequest } from "./worker";
import type { AttachmentInfo } from "../attachments/model";
import { PdfWorkerClient } from "./workerClient";
const client = new PdfWorkerClient(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));
const run = <T>(...args: Parameters<PdfWorkerClient["run"]>) => client.run<T>(...args);
export const resetExportWorker = () => client.reset();
export const inspectExistingText = (
  bytes: Uint8Array,
  index: number,
  signal?: AbortSignal,
) =>
  run<DirectInspection>(
    { type: "directInspect", bytes, index },
    undefined,
    signal,
  );
export const previewDirectPage = (
  source: Source,
  page: PageModel,
  signal: AbortSignal,
  images: Record<string, ImageAsset> = {},
) =>
  run<Uint8Array>(
    { type: "directPreview", source, page, images },
    undefined,
    signal,
  );
export const inspectLocalFont = (bytes: Uint8Array, name: string) =>
  run<FontAsset>({ type: "fontInspect", bytes, name });
export const exportDocument = (
  model: DocumentModel,
  progress?: (v: number) => void,
  signal?: AbortSignal,
  indices?: number[],
) =>
  run<Uint8Array>(
    { type: "export", model, indices } as Omit<
      Extract<WorkerRequest, { type: "export" }>,
      "id"
    >,
    progress,
    signal,
  );
export const loadForms = (model: Pick<DocumentModel, "sources">) =>
  run<FormDescriptor[]>({ type: "forms", model: { sources: model.sources } });
export const createImagePdf = (images: Parameters<typeof imagesToPdf>[0]) =>
  run<Uint8Array>({ type: "images", images } as Omit<
    Extract<WorkerRequest, { type: "images" }>,
    "id"
  >);

export const exportProject = (model: DocumentModel, signal?: AbortSignal) =>
  run<Uint8Array>({ type: "projectSave", model }, undefined, signal);
export const importProject = (bytes: Uint8Array, signal?: AbortSignal) =>
  run<DocumentModel>({ type: "projectOpen", bytes }, undefined, signal);
export const exportZip = (
  files: Record<string, Uint8Array>,
  signal?: AbortSignal,
) => run<Uint8Array>({ type: "zip", files }, undefined, signal);
export const exportSplitZip = (
  model: DocumentModel,
  indices: number[],
  groupSize: number,
  progress?: (n: number) => void,
  signal?: AbortSignal,
) =>
  run<Uint8Array>(
    { type: "split", model, indices, groupSize },
    progress,
    signal,
  );

export const loadAttachments = (
  model: Pick<DocumentModel, "sources">,
  signal?: AbortSignal,
) =>
  run<AttachmentInfo[]>(
    { type: "attachments", model: { sources: model.sources } },
    undefined,
    signal,
  );
export const readAttachment = (
  model: Pick<DocumentModel, "sources" | "attachments">,
  attachmentId: string,
  signal?: AbortSignal,
) =>
  run<Uint8Array>(
    {
      type: "attachmentExtract",
      model: { sources: model.sources, attachments: model.attachments },
      attachmentId,
    },
    undefined,
    signal,
  );

export const extractImagePdf = (
  bytes: Uint8Array,
  reference: SourceImageReference,
  signal?: AbortSignal,
) =>
  run<Uint8Array>(
    { type: "imageExtract", bytes, reference },
    undefined,
    signal,
  );
