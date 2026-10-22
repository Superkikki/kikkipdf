import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from "pdf-lib";
import type { LayerOrderNode, Source } from "../state/model";
import { parseLayerOrder } from "./order";
const key = (name: string) => PDFName.of(name);
export const groupRefId = (ref: PDFRef) => `${ref.objectNumber}R${ref.generationNumber || ""}`;
export function layerGroupIds(pdf: PDFDocument): string[] {
  const properties = pdf.catalog.lookupMaybe(key("OCProperties"), PDFDict);
  const groups = properties?.lookupMaybe(key("OCGs"), PDFArray);
  if (!groups || groups.size() > 10000) throw Error("元PDFのレイヤー一覧を確認できません。");
  const ids = groups.asArray().map(ref => {
    if (!(ref instanceof PDFRef) || pdf.context.lookup(ref, PDFDict).get(key("Type")) !== key("OCG")) throw Error("レイヤー参照が不正です。");
    return groupRefId(ref);
  });
  if (new Set(ids).size !== ids.length) throw Error("レイヤー参照が重複しています。");
  return ids;
}
export function readLayerOrder(pdf: PDFDocument, known: ReadonlySet<string>): LayerOrderNode[] {
  const properties = pdf.catalog.lookupMaybe(key("OCProperties"), PDFDict);
  const order = properties?.lookupMaybe(key("D"), PDFDict)?.lookupMaybe(key("Order"), PDFArray);
  const seen = new Set<string>(); let remaining = 20000, heading = 0;
  const walk = (array: PDFArray, depth: number): LayerOrderNode[] => {
    if (depth > 12 && array.size() > 0) throw Error("レイヤー階層は12段までです。");
    const nodes: LayerOrderNode[] = [];
    for (let i = 0; i < array.size(); i++) {
      if (--remaining < 0) throw Error("レイヤー順序が複雑すぎます。");
      const ref = array.get(i);
      if (ref instanceof PDFRef && known.has(groupRefId(ref))) {
        const id = groupRefId(ref);
        if (seen.has(id)) throw Error("複数箇所に配置されたレイヤーの順序は編集できません。");
        seen.add(id); nodes.push({ key: `group:${id}`, groupId: id, children: [] }); continue;
      }
      const nested = pdf.context.lookup(ref);
      const title = nested instanceof PDFArray && nested.size() ? nested.lookup(0) : undefined;
      if (!(nested instanceof PDFArray) || !(title instanceof PDFString || title instanceof PDFHexString))
        throw Error("名前付き見出し以外の複雑なレイヤー階層は編集できません。");
      const children = pdf.context.obj(nested.asArray().slice(1));
      nodes.push({ key: `heading:${++heading}`, title: title.decodeText(), children: walk(children, depth + 1) });
    }
    return nodes;
  };
  const nodes = order ? walk(order, 1) : [];
  for (const id of known) if (!seen.has(id)) nodes.push({ key: `group:${id}`, groupId: id, children: [] });
  return parseLayerOrder(nodes, known);
}
export async function validateSourceLayerOrder(source: Source) {
  if (source.layerOrder !== undefined) parseLayerOrder(source.layerOrder, new Set(layerGroupIds(await PDFDocument.load(source.bytes))));
}
