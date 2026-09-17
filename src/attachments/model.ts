import type { Command } from "../commands/history";
import type { AttachmentAsset, AttachmentEdit } from "../state/model";

export interface AttachmentInfo {
  id: string;
  sourceId: string;
  name: string;
  description: string;
  size?: number;
  documentLevel: boolean;
  pages: number[];
}
export const MAX_ATTACHMENT_BYTES = 128 * 1024 * 1024;
/** A PDF file name is untrusted metadata, never an output path. */
export function attachmentName(name: string) {
  let result = (name.split(/[\\/]/).pop() ?? "")
    // Strip control bytes in names supplied by untrusted PDF metadata.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*\u007f]/g, "_")
    .replace(/[ .]+$/g, "")
    .slice(0, 180);
  if (!result || /^\.+$/.test(result)) result = "attachment.bin";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result))
    result = "_" + result;
  return result;
}
export function uniqueAttachmentName(name: string, names: Set<string>) {
  const clean = attachmentName(name);
  let result = clean,
    n = 2;
  const dot = clean.lastIndexOf("."),
    base = dot > 0 ? clean.slice(0, dot) : clean,
    extension = dot > 0 ? clean.slice(dot) : "";
  while (names.has(result.toLowerCase()))
    result = `${base} (${n++})${extension}`;
  names.add(result.toLowerCase());
  return result;
}
export const addAttachments = (assets: AttachmentAsset[]): Command => ({
  label: "添付ファイルを追加",
  apply: (d) => {
    if (assets.some((a) => a.bytes.length > MAX_ATTACHMENT_BYTES))
      throw Error("添付ファイルは1件128MBまで対応しています。");
    return { ...d, attachments: [...(d.attachments ?? []), ...assets] };
  },
});
export const editAttachment = (id: string, patch: AttachmentEdit): Command => ({
  label: patch.deleted ? "添付ファイルを削除" : "添付ファイルを編集",
  apply: (d) => ({
    ...d,
    attachmentEdits: {
      ...d.attachmentEdits,
      [id]: { ...d.attachmentEdits?.[id], ...patch },
    },
  }),
});
