import { PDFHexString, PDFString, PDFName, type PDFDocument, type PDFPage } from "pdf-lib";
import type { BookmarkModel } from "../state/model";
import { validatedLinkUrl } from "../links/target";
import { bookmarkDestinationParameters } from "../pages/bookmarkDestination";
/** Build a new outline linked to exported page references, including after reorder/extraction. */
export function writeBookmarks(
  pdf: PDFDocument,
  nodes: BookmarkModel[],
  pages: Map<string, PDFPage>,
) {
  function prune(items: BookmarkModel[]): BookmarkModel[] {
    return items.flatMap((b) => {
      if (b.destination !== undefined) {
        if (b.pageId === undefined || b.url !== undefined)
          throw Error("しおりのページ内移動先にはページが必要です。");
        bookmarkDestinationParameters(b.destination);
      }
      if (b.color !== undefined && !/^#[\da-f]{6}$/i.test(b.color))
        throw Error("しおりの文字色が不正です。");
      if (b.url !== undefined) {
        if (b.pageId !== undefined)
          throw Error("しおりの移動先はページかURLのいずれかにしてください。");
        validatedLinkUrl(b.url);
      }
      const children = prune(b.children);
      if (b.pageId && !pages.has(b.pageId)) return children;
      return [{ ...b, children }];
    });
  }
  const tree = prune(nodes);
  if (!tree.length) return;
  const context = pdf.context,
    root = context.obj({ Type: "Outlines" }),
    rootRef = context.register(root);
  const visible = (items: BookmarkModel[]): number =>
    items.reduce(
      (n, b) => n + 1 + (b.expanded === false ? 0 : visible(b.children)),
      0,
    );
  function build(items: BookmarkModel[], parent: typeof rootRef) {
    const dicts = items.map(() => context.obj({})),
      refs = dicts.map((d) => context.register(d));
    items.forEach((b, i) => {
      const dict = dicts[i];
      dict.set(PDFName.of("Title"), PDFHexString.fromText(b.title));
      if (b.color !== undefined)
        dict.set(PDFName.of("C"), context.obj(
          [1, 3, 5].map((i) => parseInt(b.color!.slice(i, i + 2), 16) / 255),
        ));
      const flags = (b.italic ? 1 : 0) | (b.bold ? 2 : 0);
      if (flags) dict.set(PDFName.of("F"), context.obj(flags));
      dict.set(PDFName.of("Parent"), parent);
      if (i) dict.set(PDFName.of("Prev"), refs[i - 1]);
      if (i + 1 < refs.length) dict.set(PDFName.of("Next"), refs[i + 1]);
      const page = b.pageId ? pages.get(b.pageId) : undefined;
      if (page) dict.set(PDFName.of("Dest"), context.obj([
        page.ref, ...(b.destination ? bookmarkDestinationParameters(b.destination) : ["Fit"]),
      ]));
      else if (b.url !== undefined)
        dict.set(PDFName.of("A"), context.obj({
          S: "URI", URI: PDFString.of(validatedLinkUrl(b.url)),
        }));
      if (b.children.length) {
        const children = build(b.children, refs[i]);
        dict.set(PDFName.of("First"), children[0]);
        dict.set(PDFName.of("Last"), children.at(-1)!);
        dict.set(
          PDFName.of("Count"),
          context.obj((b.expanded === false ? -1 : 1) * visible(b.children)),
        );
      }
    });
    return refs;
  }
  const refs = build(tree, rootRef);
  root.set(PDFName.of("First"), refs[0]);
  root.set(PDFName.of("Last"), refs.at(-1)!);
  root.set(PDFName.of("Count"), context.obj(visible(tree)));
  pdf.catalog.set(PDFName.of("Outlines"), rootRef);
}
