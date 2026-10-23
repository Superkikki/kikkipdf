import { z } from "zod";
import { change } from "../commands/document";
import { uid, type BookmarkModel, type BookmarkDestination, type DocumentModel } from "../state/model";
import { validatedLinkUrl } from "../links/target";
import { bookmarkDestinationSchema } from "./bookmarkDestination";

export const MAX_BOOKMARK_FILE_BYTES = 8 * 1024 * 1024;
export interface PortableBookmark {
  title: string;
  page?: number;
  destination?: BookmarkDestination;
  url?: string;
  expanded?: boolean;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  children: PortableBookmark[];
}
export interface BookmarkFile {
  format: "kikki-pdf-bookmarks";
  version: 1;
  pageCount: number;
  bookmarks: PortableBookmark[];
}
const attributes = z.object({
  title: z.string().max(1000000), page: z.number().int().min(1).max(10000).optional(),
  destination: bookmarkDestinationSchema.optional(), url: z.string().max(8192).optional(),
  expanded: z.boolean().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  bold: z.boolean().optional(), italic: z.boolean().optional(), children: z.array(z.unknown()),
}).strict().refine(node => !(node.page !== undefined && node.url !== undefined) && !(node.destination && node.page === undefined),
  { message: "しおりの移動先はページまたはURLを指定してください。" });

/** Bound all JSON nesting before validating recursive bookmark data. */
function boundJson(value: unknown) {
  const pending = [{ value, depth: 0 }]; let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++count > 250000 || depth > 64) throw Error("しおりファイルの構造が複雑すぎます。");
    if (value && typeof value === "object") for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
  }
}
export function validateBookmarkFile(value: unknown): BookmarkFile {
  boundJson(value);
  const file = z.object({ format: z.literal("kikki-pdf-bookmarks"), version: z.literal(1),
    pageCount: z.number().int().min(1).max(10000), bookmarks: z.array(z.unknown()) }).strict().safeParse(value);
  if (!file.success) throw Error("しおりJSONの形式またはバージョンが不正です。");
  let count = 0;
  const walk = (items: unknown[], depth: number): PortableBookmark[] => items.map(value => {
    if (++count > 10000 || depth > 24) throw Error("しおりは合計10000件・24階層までです。");
    const parsed = attributes.safeParse(value);
    if (!parsed.success) throw Error("しおりの名前・移動先・装飾が不正です。");
    const node = parsed.data;
    if (node.page !== undefined && node.page > file.data.pageCount) throw Error("しおりのページ番号が元文書の範囲外です。");
    return { ...node, ...(node.url !== undefined ? { url: validatedLinkUrl(node.url) } : {}), children: walk(node.children, depth + 1) };
  });
  return { ...file.data, bookmarks: walk(file.data.bookmarks, 1) };
}
export function readBookmarkFile(bytes: Uint8Array): BookmarkFile {
  if (bytes.length > MAX_BOOKMARK_FILE_BYTES) throw Error("しおりJSONは8MBまでです。");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw Error("UTF-8の正しいしおりJSONを選択してください。"); }
  return validateBookmarkFile(value);
}
export function checkBookmarkTree(nodes: BookmarkModel[]): Set<string> {
  const pending = nodes.map(node => ({ node, depth: 1 })), ids = new Set<string>();
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (ids.size >= 10000 || depth > 24) throw Error("しおりは合計10000件・24階層までです。");
    if (ids.has(node.id)) throw Error("しおりのIDが重複しています。");
    ids.add(node.id);
    for (const child of node.children) pending.push({ node: child, depth: depth + 1 });
  }
  return ids;
}
export function bookmarksJson(model: DocumentModel): Uint8Array {
  checkBookmarkTree(model.bookmarks ?? []);
  const pages = new Map(model.pages.map((page, index) => [page.id, index + 1]));
  const walk = (nodes: BookmarkModel[]): PortableBookmark[] => nodes.map(node => {
    const { pageId, title, destination, url, expanded, color, bold, italic } = node;
    if (pageId && !pages.has(pageId)) throw Error("しおりの移動先ページがありません。");
    return { title, destination, url, expanded, color, bold, italic, ...(pageId ? { page: pages.get(pageId)! } : {}), children: walk(node.children) };
  });
  const file = validateBookmarkFile({ format: "kikki-pdf-bookmarks", version: 1, pageCount: model.pages.length, bookmarks: walk(model.bookmarks ?? []) });
  const bytes = new TextEncoder().encode(JSON.stringify(file, null, 2) + "\n");
  if (bytes.length > MAX_BOOKMARK_FILE_BYTES) throw Error("しおりJSONは8MBまでです。");
  return bytes;
}
export function importBookmarks(snapshot: DocumentModel, input: BookmarkFile, pageOffset: number) {
  const file = validateBookmarkFile(input);
  if (!Number.isInteger(pageOffset) || Math.abs(pageOffset) > 9999) throw Error("ページ番号の補正は-9999〜9999の整数で指定してください。");
  return change("しおりJSONを追加", document => {
    if (document !== snapshot) throw Error("文書が変更されました。しおりJSONを選び直してください。");
    const ids = checkBookmarkTree(document.bookmarks ?? []);
    const walk = (nodes: PortableBookmark[]): BookmarkModel[] => nodes.map(node => {
      if (ids.size >= 10000) throw Error("追加後のしおりは合計10000件までです。");
      const { page, ...rest } = node;
      const target = page !== undefined ? document.pages[page + pageOffset - 1] : undefined;
      if (page !== undefined && !target) throw Error("補正後のしおりのページ番号が文書の範囲外です。");
      let id: string = uid(); while (ids.has(id)) id = uid(); ids.add(id);
      return { ...rest, id, ...(target ? { pageId: target.id } : {}), children: walk(node.children) };
    });
    const added = walk(file.bookmarks);
    return added.length ? { ...document, bookmarks: [...(document.bookmarks ?? []), ...added] } : document;
  });
}
export function bookmarkDeletionPlan(model: DocumentModel, query: string) {
  checkBookmarkTree(model.bookmarks ?? []);
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase(); let matched = 0, removed = 0;
  const walk = (nodes: BookmarkModel[], ancestorRemoved = false): BookmarkModel[] => nodes.flatMap(node => {
    const matches = node.title.normalize("NFKC").toLocaleLowerCase().includes(needle);
    if (matches) matched++;
    const deleting = ancestorRemoved || matches;
    if (deleting) removed++;
    const children = walk(node.children, deleting);
    return deleting ? [] : [children.every((child, i) => child === node.children[i]) && children.length === node.children.length ? node : { ...node, children }];
  });
  const bookmarks = walk(model.bookmarks ?? []);
  return { matched, removed, bookmarks };
}
export function deleteMatchingBookmarks(snapshot: DocumentModel, query: string) {
  const plan = bookmarkDeletionPlan(snapshot, query);
  return change("絞り込んだしおりを一括削除", document => {
    if (document !== snapshot) throw Error("文書が変更されました。削除するしおりを確認し直してください。");
    return plan.removed ? { ...document, bookmarks: plan.bookmarks } : document;
  });
}
