import { change } from "../commands/document";

export const renameLayer = (sourceId: string, id: string, name: string, knownIds: readonly string[]) => {
  if (!knownIds.includes(id)) throw Error("レイヤーが見つかりません。");
  if (!name.trim() || name.length > 1000) throw Error("レイヤー名は空でない1000文字以下にしてください。");
  return change("レイヤー名を変更", document => {
    const source = document.sources[sourceId];
    if (!source) throw Error("参照元PDFがありません。");
    return { ...document, sources: { ...document.sources,
      [sourceId]: { ...source, layerNames: { ...source.layerNames, [id]: name } } } };
  });
};

export const resetLayerNames = (sourceId: string) => change("レイヤー名を戻す", document => {
  const source = document.sources[sourceId];
  if (!source) throw Error("参照元PDFがありません。");
  return { ...document, sources: { ...document.sources, [sourceId]: { ...source, layerNames: undefined } } };
});
