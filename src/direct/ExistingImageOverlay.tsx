import { useEffect, useState } from "react";
import { inspectExistingText } from "../export/client";
import { textReferenceKey, type DirectImageRun } from "./model";
import { newObject, type DocumentModel, type PageModel } from "../state/model";
import { documentStore } from "../state/store";
import { addObject } from "../commands/document";

export function ExistingImageOverlay({ model, page, onSelect, onError }: {
  model: DocumentModel; page: PageModel; onSelect: (id: string) => void; onError?: (message: string) => void;
}) {
  const [images, setImages] = useState<DirectImageRun[]>([]);
  const source = page.sourceId ? model.sources[page.sourceId] : undefined;
  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    void inspectExistingText(source.bytes, page.sourceIndex, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setImages(result.images ?? []);
      if (!result.images?.length && result.unsupported) onError?.(result.unsupported);
    }).catch(error => {
      if (error?.name !== "AbortError") onError?.("既存画像を解析できません。");
    });
    return () => controller.abort();
  }, [source, page.sourceIndex, onError]);
  const edited = new Set(page.objects.filter(o => o.sourceImage).map(o => textReferenceKey(o.sourceImage!)));
  return <svg className="existing-image-layer" width={page.width} height={page.height} viewBox={`0 0 ${page.width} ${page.height}`}>
    {images.filter(image => !edited.has(textReferenceKey(image.reference))).map((image, i) =>
      <rect key={textReferenceKey(image.reference)} x={image.x} y={image.y} width={image.width} height={image.height}
        role="button" tabIndex={0} aria-label={`既存画像 ${i + 1}`} fill="#078c7f12" stroke="#078c7f" strokeDasharray="5 3"
        onPointerDown={event => event.stopPropagation()}
        onDoubleClick={event => { event.stopPropagation(); select(image); }}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(image); } }}>
        <title>ダブルクリックして画像を編集</title>
      </rect>)}
  </svg>;
  function select(image: DirectImageRun) {
    const current = documentStore.document?.pages.find(p => p.id === page.id);
    if (!current || documentStore.document?.id !== model.id || !current.sourceId ||
        current.objects.some(o => o.sourceImage && textReferenceKey(o.sourceImage) === textReferenceKey(image.reference))) return;
    window.getSelection()?.removeAllRanges();
    const { x, y, width, height } = image;
    const object = { ...newObject("direct-image", x, y), width, height, sourceImage: {
      ...image.reference, sourceId: current.sourceId, originalBox: { x, y, width, height }, bounds: image.bounds,
    } };
    documentStore.execute(addObject(page.id, object)); onSelect(object.id);
  }
}
