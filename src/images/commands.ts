import { change } from "../commands/document";
import type { ImageAsset } from "../state/model";
export function replaceDirectImage(pageId: string, objectId: string, asset: ImageAsset) {
  return change("既存画像の差し替え", d => {
    const object = d.pages.find(p => p.id === pageId)?.objects.find(o => o.id === objectId);
    if (!object || object.kind !== "direct-image" || !object.sourceImage) throw Error("差し替える既存画像がありません。");
    if (!asset.id || d.images[asset.id] || !asset.bytes.length || asset.bytes.length > 32 * 1024 * 1024 ||
      !["image/png", "image/jpeg"].includes(asset.mime)) throw Error("差し替え画像が不正です。");
    return { ...d, images: { ...d.images, [asset.id]: asset }, pages: d.pages.map(p => p.id !== pageId ? p :
      { ...p, objects: p.objects.map(o => o.id !== objectId ? o : { ...o, imageId: asset.id, imageDeleted: false }) }) };
  });
}
