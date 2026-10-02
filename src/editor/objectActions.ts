import { change, editPage } from "../commands/document";
import {
  uid,
  type EditObject,
  type ImageAsset,
  type FontAsset,
} from "../state/model";
import { checkFontBudget } from "../fonts/budget";
export interface ObjectClipboard {
  object: EditObject;
  image?: ImageAsset;
  font?: FontAsset;
}
export function pasteObject(pageId: string, clipboard: ObjectClipboard) {
  const id = uid(),
    image = clipboard.image ? { ...clipboard.image, id: uid() } : undefined;
  return {
    id,
    command: change("オブジェクト貼り付け", (d) => {
      const fonts = clipboard.font
        ? { ...d.fonts, [clipboard.font.id]: clipboard.font }
        : d.fonts;
      checkFontBudget(fonts ?? {});
      if (
        clipboard.object.font === "custom" &&
        (!clipboard.object.fontId || !fonts?.[clipboard.object.fontId])
      )
        throw Error("コピー元のフォントが見つかりません。");
      return {
        ...d,
        images: image ? { ...d.images, [image.id]: image } : d.images,
        fonts,
        pages: d.pages.map((p) =>
          p.id === pageId
            ? {
                ...p,
                objects: [
                  ...p.objects,
                  {
                    ...clipboard.object,
                    ...(clipboard.object.kind === "direct-text"
                      ? { kind: "text" as const, sourceText: undefined }
                      : {}),
                    id,
                    imageId: image?.id ?? clipboard.object.imageId,
                    x: Math.max(
                      0,
                      Math.min(
                        p.width - clipboard.object.width,
                        clipboard.object.x + 12,
                      ),
                    ),
                    y: Math.max(
                      0,
                      Math.min(
                        p.height - clipboard.object.height,
                        clipboard.object.y + 12,
                      ),
                    ),
                  },
                ],
              }
            : p,
        ),
      };
    }),
  };
}
export function reorderObject(
  pageId: string,
  id: string,
  direction: "front" | "back" | "forward" | "backward",
) {
  return editPage(
    pageId,
    (p) => {
      const i = p.objects.findIndex((o) => o.id === id);
      if (i < 0) return p;
      const j =
        direction === "front"
          ? p.objects.length - 1
          : direction === "back"
            ? 0
            : Math.max(
                0,
                Math.min(
                  p.objects.length - 1,
                  i + (direction === "forward" ? 1 : -1),
                ),
              );
      const objects = [...p.objects];
      objects.splice(j, 0, objects.splice(i, 1)[0]);
      return { ...p, objects };
    },
    "重なり順を変更",
  );
}
