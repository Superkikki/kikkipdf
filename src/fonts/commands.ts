import type { FontAsset } from "../state/model";
import { change } from "../commands/document";
import { checkFontBudget } from "./budget";

export function registerFont(
  asset: FontAsset,
  pageId: string,
  objectId: string,
) {
  return change("フォントを登録・適用", (d) => {
    const object = d.pages
      .find((p) => p.id === pageId)
      ?.objects.find((o) => o.id === objectId);
    if (
      !d.pages.some(
        (p) => p.id === pageId && p.objects.some((o) => o.id === objectId),
      )
    )
      return d;
    const existing = d.fonts?.[asset.id];
    if (
      existing &&
      object?.font === "custom" &&
      object.fontId === asset.id &&
      !object.bold &&
      !object.italic
    )
      return d;
    // Preserve the immutable asset across duplicate imports and undo revisions.
    const fonts = { ...d.fonts, [asset.id]: existing ?? asset };
    checkFontBudget(fonts);
    return {
      ...d,
      fonts,
      pages: d.pages.map((p) =>
        p.id !== pageId
          ? p
          : {
              ...p,
              objects: p.objects.map((o) =>
                o.id !== objectId
                  ? o
                  : {
                      ...o,
                      font: "custom" as const,
                      fontId: asset.id,
                      bold: false,
                      italic: false,
                    },
              ),
            },
      ),
    };
  });
}
export function removeUnusedFonts() {
  return change("未使用フォントを削除", (d) => {
    const used = new Set(
      d.pages.flatMap((p) =>
        p.objects.filter((o) => o.font === "custom").map((o) => o.fontId),
      ),
    );
    const fonts = Object.fromEntries(
      Object.entries(d.fonts ?? {}).filter(([id]) => used.has(id)),
    );
    return Object.keys(fonts).length === Object.keys(d.fonts ?? {}).length
      ? d
      : { ...d, fonts };
  });
}
