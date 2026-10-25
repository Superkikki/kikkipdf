import { PDFDocument, decodePDFRawStream } from "pdf-lib";
import { zipSync } from "fflate";
import { attachmentEntries } from "./pdfAttachments";
import { MAX_ATTACHMENT_BYTES, uniqueAttachmentName, type AttachmentInfo } from "./model";
import { attachmentItems, selectedAttachments, type AttachmentModel } from "./batch";
export const MAX_ATTACHMENT_ARCHIVE_BYTES = 256 * 1024 * 1024;

/** Worker-only: parse each source once, bound decoded data, return one complete ZIP. */
export async function attachmentsZip(model: AttachmentModel, ids: string[], progress: (n: number) => void = () => {}) {
  if (!ids.length || ids.length > 1000 || new Set(ids).size !== ids.length) throw Error("添付の一括取り出しは重複のない1〜1000件を指定してください。");
  const entries = new Map<string, ReturnType<typeof attachmentEntries>[number]>(), imported: AttachmentInfo[] = [];
  for (const source of Object.values(model.sources)) {
    for (const entry of attachmentEntries(await PDFDocument.load(source.bytes), source.id)) {
      entries.set(entry.id, entry); imported.push(entry);
    }
  }
  const selected = selectedAttachments(attachmentItems(model, imported), ids), added = new Map(model.attachments?.map(a => [a.id, a]));
  if (selected.reduce((sum, item) => sum + (item.size ?? 0), 0) > MAX_ATTACHMENT_ARCHIVE_BYTES) throw Error("添付ZIPの展開後の合計は256MBまでです。範囲を絞り込んでください。");
  const files: Record<string, Uint8Array> = Object.create(null), names = new Set<string>(); let total = 0;
  for (let i = 0; i < selected.length; i++) {
    const item = selected[i], asset = added.get(item.id), entry = entries.get(item.id);
    if (item.size !== undefined && item.size > MAX_ATTACHMENT_BYTES) throw Error("取り出しは1件128MBまでです。");
    if (!asset && !entry) throw Error("取り出す添付のデータがありません。");
    const remaining = MAX_ATTACHMENT_ARCHIVE_BYTES - total;
    const data = asset?.bytes ?? decodePDFRawStream(entry!.stream).getBytes(Math.min(MAX_ATTACHMENT_BYTES, remaining) + 1);
    if (data.length > MAX_ATTACHMENT_BYTES) throw Error("添付ファイルの展開サイズが128MBを超えています。");
    total += data.length;
    if (total > MAX_ATTACHMENT_ARCHIVE_BYTES) throw Error("添付ZIPの展開後の合計は256MBまでです。範囲を絞り込んでください。");
    files[uniqueAttachmentName(item.name, names)] = new Uint8Array(data);
    progress((i + 1) / selected.length * 0.9);
  }
  const zip = zipSync(files, { level: 0 });
  if (zip.length > MAX_ATTACHMENT_ARCHIVE_BYTES) throw Error("添付ZIPは256MBまでです。範囲を絞り込んでください。");
  progress(1); return zip;
}
