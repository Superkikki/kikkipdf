import {
  blankPage,
  uid,
  type BookmarkModel,
  type DocumentModel,
  type EditObject,
  type PageModel,
} from "../state/model";
import { patchObject } from "./objects";
import type { Command } from "./history";
export const change = (label: string, apply: Command["apply"]): Command => ({
  label,
  apply,
});
export function editPage(
  id: string,
  update: (p: PageModel) => PageModel,
  label = "ページ編集",
): Command {
  return change(label, (d) => ({
    ...d,
    pages: d.pages.map((p) => (p.id === id ? update(p) : p)),
  }));
}
export function addObject(pageId: string, object: EditObject) {
  return editPage(
    pageId,
    (p) => ({ ...p, objects: [...p.objects, object] }),
    "オブジェクト追加",
  );
}
export function updateObject(
  pageId: string,
  id: string,
  patch: Partial<EditObject>,
) {
  return editPage(
    pageId,
    (p) => ({
      ...p,
      objects: p.objects.map((o) => (o.id === id ? patchObject(o, patch) : o)),
    }),
    "オブジェクト編集",
  );
}
export function deleteObject(pageId: string, id: string) {
  return editPage(
    pageId,
    (p) => ({ ...p, objects: p.objects.filter((o) => o.id !== id) }),
    "オブジェクト削除",
  );
}
export function rotatePage(id: string) {
  return editPage(
    id,
    (p) => ({ ...p, rotation: (p.rotation + 90) % 360 }),
    "ページ回転",
  );
}
export function deletePages(ids: string[]): Command {
  return change("ページ削除", (d) => {
    const pages = d.pages.filter((p) => !ids.includes(p.id));
    if (!pages.length) throw new Error("最後のページは削除できません。");
    const bookmarks = (items: BookmarkModel[]): BookmarkModel[] =>
      items.flatMap((b) => {
        const children = bookmarks(b.children);
        return b.pageId && ids.includes(b.pageId)
          ? children
          : [{ ...b, children }];
      });
    return {
      ...d,
      pages,
      formFields: d.formFields?.filter((f) => !ids.includes(f.pageId)),
      bookmarks: bookmarks(d.bookmarks ?? []),
    };
  });
}
export function duplicatePage(id: string): Command {
  return change("ページ複製", (d) => {
    const i = d.pages.findIndex((p) => p.id === id);
    if (i < 0) return d;
    const copy = {
      ...d.pages[i],
      id: uid(),
      objects: d.pages[i].objects.map((o) => ({ ...o, id: uid() })),
    };
    return {
      ...d,
      pages: [...d.pages.slice(0, i + 1), copy, ...d.pages.slice(i + 1)],
      formFields: [
        ...(d.formFields ?? []),
        ...(d.formFields ?? [])
          .filter((f) => f.pageId === id)
          .map((f) => ({
            ...f,
            id: uid(),
            pageId: copy.id,
            name: f.name + "_copy",
          })),
      ],
    };
  });
}
export function reorderPage(from: string, to: string): Command {
  return change("ページ並べ替え", (d) => {
    const pages = [...d.pages];
    const a = pages.findIndex((p) => p.id === from),
      b = pages.findIndex((p) => p.id === to);
    if (a < 0 || b < 0 || a === b) return d;
    pages.splice(b, 0, pages.splice(a, 1)[0]);
    return { ...d, pages };
  });
}
export function insertBlank(afterId?: string): Command {
  return change("空白ページ追加", (d) => {
    const i = afterId
      ? d.pages.findIndex((p) => p.id === afterId) + 1
      : d.pages.length;
    return {
      ...d,
      pages: [...d.pages.slice(0, i), blankPage(), ...d.pages.slice(i)],
    };
  });
}
export const mergeDocuments = (other: DocumentModel): Command =>
  change("PDFを追加", (d) => ({
    ...d,
    sources: { ...d.sources, ...other.sources },
    pages: [...d.pages, ...other.pages],
    images: { ...d.images, ...other.images },
    attachments: [...(d.attachments ?? []), ...(other.attachments ?? [])],
    attachmentEdits: { ...d.attachmentEdits, ...other.attachmentEdits },
    formValues: { ...d.formValues, ...other.formValues },
    formFields: [...(d.formFields ?? []), ...(other.formFields ?? [])],
    bookmarks: [...(d.bookmarks ?? []), ...(other.bookmarks ?? [])],
  }));
