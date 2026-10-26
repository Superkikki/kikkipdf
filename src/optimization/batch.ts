import type { LocalFile } from "../platform/files";
import type { OptimizationResult, ProcessingOptions } from "./engine";
import { uniqueAttachmentName } from "../attachments/model";
export interface BatchRow { input: string; output?: string; before: number; after?: number; error?: string; images?: number; skippedImages?: number }
export function validateBatch(files: LocalFile[]) {
  if (!files.length || files.length > 50 || files.some(file => !/\.pdf$/i.test(file.name) || file.bytes.length > 32 * 1024 * 1024) || files.reduce((sum, file) => sum + file.bytes.length, 0) > 256 * 1024 * 1024)
    throw Error("一括処理はPDFのみ50件、1件32MB、合計256MBまでです。");
}
export async function processBatch(files: LocalFile[], options: ProcessingOptions, process: (bytes: Uint8Array, options: ProcessingOptions) => Promise<OptimizationResult>, signal: AbortSignal, progress: (row: BatchRow, done: number) => void) {
  validateBatch(files);
  const output: Record<string, Uint8Array> = Object.create(null), names = new Set(["report.json"]), rows: BatchRow[] = []; let total = 0;
  for (const file of files) {
    signal.throwIfAborted();
    let row: BatchRow;
    try {
      const result = await process(file.bytes, options); signal.throwIfAborted();
      total += result.bytes.length;
      if (total > 256 * 1024 * 1024) throw Error("出力の合計が256MBを超えました。ファイル数を減らしてください。");
      const name = uniqueAttachmentName(file.name.replace(/\.pdf$/i, "-processed.pdf"), names);
      output[name] = result.bytes;
      row = { input: file.name, output: name, before: file.bytes.length, after: result.after, images: result.images, skippedImages: result.skippedImages };
    } catch (error) {
      signal.throwIfAborted();
      if (total > 256 * 1024 * 1024) throw error;
      row = { input: file.name, before: file.bytes.length, error: error instanceof Error ? error.message : "処理に失敗しました。" };
    }
    rows.push(row); progress(row, rows.length);
  }
  signal.throwIfAborted();
  output["report.json"] = new TextEncoder().encode(JSON.stringify({ options, files: rows }, null, 2));
  return { files: output, rows };
}
