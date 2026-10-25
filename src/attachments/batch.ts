import { change } from "../commands/document";
import type { DocumentModel, PageModel } from "../state/model";
import type { AttachmentInfo } from "./model";

export type AttachmentModel = Pick<DocumentModel, "sources" | "attachments" | "attachmentEdits"> & { pages: Pick<PageModel, "sourceId" | "sourceIndex">[] };
export interface AttachmentRow { id: string; name: string; description: string; size?: number; deleted: boolean }
export const MAX_BATCH_ATTACHMENTS = 1000;
export function attachmentItems(model: AttachmentModel, imported: AttachmentInfo[]): AttachmentRow[] {
  const ids = new Set<string>();
  return [...imported.filter(a => a.documentLevel || model.pages.some(p => p.sourceId === a.sourceId && a.pages.includes(p.sourceIndex))),
    ...(model.attachments ?? []).map(a => ({ id: a.id, name: a.name, description: a.description, size: a.bytes.length }))]
    .map(a => {
      if (ids.has(a.id)) throw Error("添付ファイルのIDが重複しています。");
      ids.add(a.id);
      const edit = model.attachmentEdits?.[a.id];
      return { id: a.id, name: edit?.name ?? a.name, description: edit?.description ?? a.description, size: a.size, deleted: edit?.deleted ?? false };
    });
}
export function filterAttachments(items: AttachmentRow[], query: string, deleted: boolean) {
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase();
  return items.filter(a => a.deleted === deleted && `${a.name}\n${a.description}`.normalize("NFKC").toLocaleLowerCase().includes(needle));
}
export function selectedAttachments(items: AttachmentRow[], ids: string[], deleted = false) {
  if (!ids.length || ids.length > MAX_BATCH_ATTACHMENTS || new Set(ids).size !== ids.length) throw Error("添付の一括操作は重複のない1〜1000件を指定してください。");
  const known = new Map(items.map(a => [a.id, a]));
  return ids.map(id => {
    const item = known.get(id);
    if (!item || item.deleted !== deleted) throw Error("操作対象の添付ファイルが見つからないか、削除状態が変わっています。");
    return item;
  });
}
export function batchAttachmentDeletion(snapshot: DocumentModel, imported: AttachmentInfo[], ids: string[], deleted: boolean) {
  const rows = selectedAttachments(attachmentItems(snapshot, imported), ids, !deleted);
  return change(deleted ? "添付ファイルを一括削除" : "添付ファイルを一括復元", document => {
    if (document !== snapshot) throw Error("文書が変更されました。操作する添付を確認し直してください。");
    const edits = { ...document.attachmentEdits };
    for (const row of rows) edits[row.id] = { ...edits[row.id], deleted };
    return { ...document, attachmentEdits: edits };
  });
}
