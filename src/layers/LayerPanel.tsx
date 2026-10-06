import { useEffect, useState } from "react";
import type { DocumentModel, Source } from "../state/model";
import { documentStore } from "../state/store";
import { usePrompt } from "../components/Prompt";
import { renameLayer, resetLayerNames } from "./commands";
import { readLayers, resetLayerVisibility, setLayerVisibility, type LayerInfo } from "./model";

function SourceLayers({ source }: { source: Source }) {
  const prompt = usePrompt();
  const [info, setInfo] = useState<LayerInfo>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    readLayers(source).then((value) => { if (live) setInfo(value); }, () => {
      if (live) setError("レイヤー設定を読み込めません。");
    });
    return () => { live = false; };
  }, [source]);
  const groups = new Map(info?.groups.map((group) => [group.id, group]));
  return <section className="source-layers" aria-label={`${source.name}のレイヤー`}>
    <h3 title={source.name}>{source.name}</h3>
    {!info && !error && <p role="status">レイヤーを読み込み中…</p>}
    {error && <p role="alert">{error}</p>}
    {info && !info.groups.length && <p>このPDFにはレイヤーがありません。</p>}
    {info?.rows.map((row, index) => {
      if (!row.id) return <div className="layer-heading" key={index} style={{ paddingLeft: row.depth * 12 }}>{row.name}</div>;
      const group = groups.get(row.id)!;
      const name = source.layerNames?.[group.id] ?? group.name;
      return <div className="layer-row" key={row.id} style={{ paddingLeft: row.depth * 12 }} title={name}>
        <input type="checkbox" aria-label={name} checked={source.layerVisibility?.[group.id] ?? group.visible}
          disabled={group.locked} onChange={(event) => {
            try {
              documentStore.execute(setLayerVisibility(source.id, group.id, event.target.checked, info));
              setError("");
            } catch (reason) { setError(reason instanceof Error ? reason.message : "表示を変更できません。"); }
          }} />
        <span>{name}</span>{group.locked && <small>ロック</small>}
        <button aria-label={`${name}の名前を変更`} onClick={() => void (async () => {
          const result = await prompt.ask({ title: "レイヤー名を変更", fields: [{ key: "name", label: "レイヤー名", value: name }] });
          if (!result) return;
          try { documentStore.execute(renameLayer(source.id, group.id, result.name, info.groups.map(g => g.id))); setError(""); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "名前を変更できません。"); }
        })()}>名称変更</button>
      </div>;
    })}
    {prompt.dialog}
    {!!Object.keys(source.layerNames ?? {}).length && <button onClick={() => documentStore.execute(resetLayerNames(source.id))}>元のレイヤー名に戻す</button>}
    {!!info?.groups.length && <button disabled={!Object.keys(source.layerVisibility ?? {}).length}
      onClick={() => { documentStore.execute(resetLayerVisibility(source.id)); setError(""); }}>初期表示に戻す</button>}
  </section>;
}

export function LayerPanel({ model }: { model: DocumentModel }) {
  const sourceIds = new Set(model.pages.map((page) => page.sourceId));
  const sources = Object.values(model.sources).filter((source) => sourceIds.has(source.id));
  return <div className="layer-panel">
    <p>表示状態と名称変更はPDF保存に反映されます。</p>
    {!sources.length && <p>この文書には元PDFのレイヤーがありません。</p>}
    {sources.map((source) => <SourceLayers key={source.id} source={source} />)}
  </div>;
}
