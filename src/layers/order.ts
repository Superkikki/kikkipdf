import type { DocumentModel, LayerOrderNode } from "../state/model";
import { uid } from "../state/model";
import { change } from "../commands/document";
import type { LayerInfo, LayerRow } from "./model";

/** Bound recursion before descending into untrusted project data. */
export function parseLayerOrder(value: unknown, known?: ReadonlySet<string>): LayerOrderNode[] {
  const keys = new Set<string>(), groups = new Set<string>();
  let remaining = 20000;
  const walk = (value: unknown, depth: number): LayerOrderNode[] => {
    if (!Array.isArray(value) || depth > 12 && value.length > 0) throw Error("レイヤー階層は12段までです。");
    return value.map(item => {
      if (--remaining < 0 || !item || typeof item !== "object" || Array.isArray(item)) throw Error("レイヤー順序の項目が不正か多すぎます。");
      const node = item as Record<string, unknown>;
      if (typeof node.key !== "string" || keys.has(node.key) || !Array.isArray(node.children) ||
          Object.keys(node).some(key => !["key", "groupId", "title", "children"].includes(key))) throw Error("レイヤー順序のIDまたは構造が不正です。");
      keys.add(node.key);
      if (node.groupId !== undefined) {
        const id = node.groupId;
        if (typeof id !== "string" || !/^[1-9]\d*R(?:[1-9]\d*)?$/.test(id) || node.key !== `group:${id}` ||
            node.title !== undefined || node.children.length || groups.has(id) || known && !known.has(id)) throw Error("レイヤー順序の参照が不正です。");
        groups.add(id);
        return { key: node.key, groupId: id, children: [] };
      }
      if (!/^heading:[\w-]{1,100}$/.test(node.key) || typeof node.title !== "string" || node.title.length > 1000) throw Error("レイヤーの見出しが不正です。");
      return { key: node.key, title: node.title, children: walk(node.children, depth + 1) };
    });
  };
  const result = walk(value, 1);
  if (known && groups.size !== known.size) throw Error("レイヤー順序に必要な参照がありません。");
  return result;
}

export function locateLayerNode(nodes: LayerOrderNode[], key: string, parent?: LayerOrderNode): {
  node: LayerOrderNode; siblings: LayerOrderNode[]; index: number; parent?: LayerOrderNode;
} | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.key === key) return { node, siblings: nodes, index, parent };
    const found = locateLayerNode(node.children, key, node);
    if (found) return found;
  }
}

export function layerOrderRows(nodes: LayerOrderNode[], info: LayerInfo): LayerRow[] {
  const names = new Map(info.groups.map(group => [group.id, group.name])), rows: LayerRow[] = [];
  const walk = (nodes: LayerOrderNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ ...(node.groupId ? { id: node.groupId } : {}), name: node.groupId ? names.get(node.groupId)! : node.title || "名称なし", depth });
      walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0); return rows;
}

function editOrder(sourceId: string, info: LayerInfo, label: string, edit: (nodes: LayerOrderNode[]) => void) {
  return change(label, document => {
    const source = document.sources[sourceId];
    if (!source || !info.order || info.orderError) throw Error(info.orderError || "このPDFのレイヤー順序は編集できません。");
    const known = new Set(info.groups.map(group => group.id)), current = source.layerOrder ?? info.order;
    const next = parseLayerOrder(current, known);
    edit(next); const checked = parseLayerOrder(next, known);
    if (JSON.stringify(checked) === JSON.stringify(current)) return document;
    const changed = { ...source };
    if (JSON.stringify(checked) === JSON.stringify(info.order)) delete changed.layerOrder;
    else changed.layerOrder = checked;
    return { ...document, sources: { ...document.sources, [sourceId]: changed } };
  });
}
const titleValue = (title: string) => {
  if (!title.trim() || title.length > 1000) throw Error("見出しは空でない1000文字以下にしてください。");
  return title;
};
export function addLayerHeading(sourceId: string, title: string, info: LayerInfo, key = `heading:${uid()}`) {
  titleValue(title);
  return editOrder(sourceId, info, "レイヤー見出しを追加", nodes => { nodes.push({ key, title, children: [] }); });
}
export function renameLayerHeading(sourceId: string, key: string, title: string, info: LayerInfo) {
  titleValue(title);
  return editOrder(sourceId, info, "レイヤー見出しを変更", nodes => {
    const found = locateLayerNode(nodes, key);
    if (!found || found.node.groupId) throw Error("見出しが見つかりません。");
    found.node.title = title;
  });
}
export function removeLayerHeading(sourceId: string, key: string, info: LayerInfo) {
  return editOrder(sourceId, info, "レイヤー見出しを解除", nodes => {
    const found = locateLayerNode(nodes, key);
    if (!found || found.node.groupId) throw Error("見出しが見つかりません。");
    found.siblings.splice(found.index, 1, ...found.node.children);
  });
}
export function moveLayerNode(sourceId: string, key: string, parentKey: string | undefined, index: number | undefined, info: LayerInfo) {
  return editOrder(sourceId, info, "レイヤー順序・階層を変更", nodes => {
    const found = locateLayerNode(nodes, key), parent = parentKey ? locateLayerNode(nodes, parentKey)?.node : undefined;
    if (!found || parentKey && !parent || parent?.groupId || parentKey === key || parentKey && locateLayerNode(found.node.children, parentKey))
      throw Error("移動先の見出しが不正です。");
    found.siblings.splice(found.index, 1);
    const target = parent ? parent.children : nodes, position = index ?? target.length;
    if (!Number.isInteger(position) || position < 0 || position > target.length) throw Error("移動先の位置が不正です。");
    target.splice(position, 0, found.node);
  });
}
export const resetLayerOrder = (sourceId: string) => change("元のレイヤー順序に戻す", (document: DocumentModel) => {
  const source = document.sources[sourceId];
  if (!source?.layerOrder) return document;
  const changed = { ...source }; delete changed.layerOrder;
  return { ...document, sources: { ...document.sources, [sourceId]: changed } };
});
