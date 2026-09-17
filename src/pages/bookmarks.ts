import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { uid, type BookmarkModel, type PageModel } from "../state/model";
import { change } from "../commands/document";

export async function readBookmarks(
  pdf: PDFDocumentProxy,
  pages: PageModel[],
): Promise<BookmarkModel[]> {
  const outline = await pdf.getOutline();
  async function walk(
    items: NonNullable<typeof outline>,
    depth = 0,
  ): Promise<BookmarkModel[]> {
    if (depth > 64) return [];
    const result: BookmarkModel[] = [];
    for (const item of items) {
      let pageId: string | undefined;
      if (item.dest) {
        try {
          const dest =
            typeof item.dest === "string"
              ? await pdf.getDestination(item.dest)
              : item.dest;
          if (dest) {
            const index =
              typeof dest[0] === "number"
                ? dest[0]
                : await pdf.getPageIndex(dest[0]);
            pageId = pages[index]?.id;
          }
        } catch {
          /* Broken destinations are retained as non-clickable headings. */
        }
      }
      result.push({
        id: uid(),
        title: item.title,
        pageId,
        children: await walk(item.items ?? [], depth + 1),
      });
    }
    return result;
  }
  return walk(outline ?? []);
}

export const mapBookmarks = (
  nodes: BookmarkModel[],
  id: string,
  update: (b: BookmarkModel) => BookmarkModel,
): BookmarkModel[] =>
  nodes.map((b) =>
    b.id === id
      ? update(b)
      : { ...b, children: mapBookmarks(b.children, id, update) },
  );
export const addBookmark = (bookmark: BookmarkModel, parentId?: string) =>
  change("しおり追加", (d) => ({
    ...d,
    bookmarks: parentId
      ? mapBookmarks(d.bookmarks ?? [], parentId, (b) => ({
          ...b,
          children: [...b.children, bookmark],
        }))
      : [...(d.bookmarks ?? []), bookmark],
  }));
export const updateBookmark = (
  id: string,
  patch: Pick<Partial<BookmarkModel>, "title" | "pageId">,
) =>
  change("しおり編集", (d) => ({
    ...d,
    bookmarks: mapBookmarks(d.bookmarks ?? [], id, (b) => ({ ...b, ...patch })),
  }));
function without(nodes: BookmarkModel[], id: string): BookmarkModel[] {
  return nodes
    .filter((b) => b.id !== id)
    .map((b) => ({ ...b, children: without(b.children, id) }));
}
export const removeBookmark = (id: string) =>
  change("しおり削除", (d) => ({
    ...d,
    bookmarks: without(d.bookmarks ?? [], id),
  }));
export function locateBookmark(
  nodes: BookmarkModel[],
  id: string,
  parentId?: string,
):
  | {
      node: BookmarkModel;
      siblings: BookmarkModel[];
      index: number;
      parentId?: string;
    }
  | undefined {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id)
      return { node: nodes[i], siblings: nodes, index: i, parentId };
    const child = locateBookmark(nodes[i].children, id, nodes[i].id);
    if (child) return child;
  }
}
export const moveBookmark = (
  id: string,
  parentId: string | undefined,
  index: number,
) =>
  change("しおり移動", (d) => {
    const tree = d.bookmarks ?? [],
      found = locateBookmark(tree, id);
    if (
      !found ||
      parentId === id ||
      (parentId && locateBookmark(found.node.children, parentId))
    )
      return d;
    if (parentId && !locateBookmark(tree, parentId)) return d;
    const trimmed = without(tree, id);
    const insert = (nodes: BookmarkModel[]) => [
      ...nodes.slice(0, index),
      found.node,
      ...nodes.slice(index),
    ];
    return {
      ...d,
      bookmarks: parentId
        ? mapBookmarks(trimmed, parentId, (b) => ({
            ...b,
            children: insert(b.children),
          }))
        : insert(trimmed),
    };
  });
