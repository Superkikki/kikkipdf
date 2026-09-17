import { change, duplicatePage, deletePages } from "../commands/document";
export const batchPageLabels = {
  rotateRight: "右に90°回転",
  rotateLeft: "左に90°回転",
  rotateHalf: "180°回転",
  duplicate: "選択ページを複製",
  reverse: "選択ページの順序を反転",
  delete: "選択ページを削除",
  resetCrop: "このアプリのトリミングを解除",
} as const;
export type BatchPageOperation = keyof typeof batchPageLabels;
export function batchPageCommand(ids: string[], operation: BatchPageOperation) {
  const selected = new Set(ids);
  return change(batchPageLabels[operation], (d) => {
    if (
      !selected.size ||
      Array.from(selected).some((id) => !d.pages.some((p) => p.id === id))
    )
      throw Error("操作対象のページが見つかりません。");
    if (operation === "delete") return deletePages([...selected]).apply(d);
    if (operation === "duplicate") {
      let next = d;
      for (const page of d.pages)
        if (selected.has(page.id)) next = duplicatePage(page.id).apply(next);
      return next;
    }
    const reversed = d.pages.filter((p) => selected.has(p.id)).reverse();
    let n = 0;
    const angle =
      operation === "rotateRight" ? 90 : operation === "rotateLeft" ? 270 : 180;
    return {
      ...d,
      pages: d.pages.map((p) =>
        !selected.has(p.id)
          ? p
          : operation === "reverse"
            ? reversed[n++]
            : operation === "resetCrop"
              ? { ...p, crop: undefined }
              : { ...p, rotation: (p.rotation + angle) % 360 },
      ),
    };
  });
}
