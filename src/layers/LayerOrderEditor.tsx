import { useState } from "react";
import { uid, type LayerOrderNode, type Source } from "../state/model";
import { documentStore } from "../state/store";
import { usePrompt } from "../components/Prompt";
import type { LayerInfo } from "./model";
import { addLayerHeading, locateLayerNode, moveLayerNode, parseLayerOrder, removeLayerHeading, renameLayerHeading, resetLayerOrder } from "./order";

export function LayerOrderEditor({ source, info, onError }: { source: Source; info: LayerInfo; onError: (error: string) => void }) {
  const [selected, setSelected] = useState("");
  const prompt = usePrompt();
  if (!info.order || info.orderError) return <p className="hint">順序・階層編集: {info.orderError || "元の順序を確認できません。"}</p>;
  const tree = parseLayerOrder(source.layerOrder ?? info.order, new Set(info.groups.map(group => group.id)));
  const found = locateLayerNode(tree, selected), names = new Map(info.groups.map(group => [group.id, source.layerNames?.[group.id] ?? group.name]));
  const flat: { node: LayerOrderNode; depth: number }[] = [];
  const walk = (nodes: LayerOrderNode[], depth: number) => {
    for (const node of nodes) { flat.push({ node, depth }); walk(node.children, depth + 1); }
  };
  walk(tree, 0);
  const label = (node: LayerOrderNode) => node.groupId ? names.get(node.groupId) : node.title || "名称なし";
  const run = (command: Parameters<typeof documentStore.execute>[0]) => {
    try { documentStore.execute(command); onError(""); return true; }
    catch (reason) { onError(reason instanceof Error ? reason.message : "レイヤー順序を変更できません。"); return false; }
  };
  return <details className="layer-order-editor">
    <summary>レイヤーの順序・階層を編集</summary>
    <p className="hint">名前付き見出しで整理します。レイヤーの表示状態・ロック・排他設定は保持します。</p>
    <button onClick={() => void (async () => {
      const result = await prompt.ask({ title: "レイヤーの見出しを作成", fields: [{ key: "title", label: "見出し名", value: "新しい見出し" }] });
      if (!result) return;
      try {
        const key = `heading:${uid()}`;
        if (run(addLayerHeading(source.id, result.title, info, key))) setSelected(key);
      } catch (reason) { onError(reason instanceof Error ? reason.message : "見出しを作成できません。"); }
    })()}>見出しを作成</button>
    <label>編集する項目<select aria-label={`${source.name}の編集するレイヤー項目`} value={found ? selected : ""}
      onChange={event => setSelected(event.target.value)}>
      <option value="">選択してください</option>
      {flat.map(({ node, depth }) => <option key={node.key} value={node.key}>{"　".repeat(depth)}{node.groupId ? "" : "見出し: "}{label(node)}</option>)}
    </select></label>
    {found && <>
      <div className="layer-order-buttons">
        <button disabled={found.index === 0} onClick={() => run(moveLayerNode(source.id, selected, found.parent?.key, found.index - 1, info))}>上へ</button>
        <button disabled={found.index === found.siblings.length - 1} onClick={() => run(moveLayerNode(source.id, selected, found.parent?.key, found.index + 1, info))}>下へ</button>
      </div>
      <label>移動先の見出し<select aria-label={`${source.name}の移動先の見出し`} value={found.parent?.key ?? ""}
        onChange={event => run(moveLayerNode(source.id, selected, event.target.value || undefined, undefined, info))}>
        <option value="">最上位</option>
        {flat.filter(({ node }) => !node.groupId && node.key !== selected && !locateLayerNode(found.node.children, node.key)).map(({ node, depth }) =>
          <option key={node.key} value={node.key}>{"　".repeat(depth)}{label(node)}</option>)}
      </select></label>
      {!found.node.groupId && <>
        <button onClick={() => void (async () => {
          const result = await prompt.ask({ title: "見出し名を変更", fields: [{ key: "title", label: "見出し名", value: found.node.title }] });
          if (!result) return;
          try { run(renameLayerHeading(source.id, selected, result.title, info)); }
          catch (reason) { onError(reason instanceof Error ? reason.message : "見出しを変更できません。"); }
        })()}>見出し名を変更</button>
        <button onClick={() => { if (run(removeLayerHeading(source.id, selected, info))) setSelected(""); }}>見出しだけを削除</button>
        <p className="hint">見出しを削除すると、中の項目は一つ外側へ移ります。画像や文字は削除しません。</p>
      </>}
    </>}
    <button disabled={!source.layerOrder} onClick={() => { if (run(resetLayerOrder(source.id))) setSelected(""); }}>元の順序・階層に戻す</button>
    {prompt.dialog}
  </details>;
}
