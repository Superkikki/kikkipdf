import { useEffect, useState } from "react";
import { uid, type DocumentModel, type Source } from "../state/model";
import { documentStore } from "../state/store";
import { usePrompt } from "../components/Prompt";
import { setAllLayerVisibility } from "./bulk";
import { renameLayer, resetLayerNames } from "./commands";
import { applyLayerPreset, deleteLayerPreset, layerPresets, saveLayerPreset } from "./presets";
import { readLayers, resetLayerVisibility, setLayerVisibility, type LayerInfo } from "./model";

function SourceLayers({ source }: { source: Source }) {
  const prompt = usePrompt();
  const [info, setInfo] = useState<LayerInfo>();
  const [error, setError] = useState("");
  const [presetId, setPresetId] = useState("");
  useEffect(() => {
    let live = true;
    readLayers(source).then((value) => { if (live) setInfo(value); }, () => {
      if (live) setError("レイヤー設定を読み込めません。");
    });
    return () => { live = false; };
  }, [source]);
  const groups = new Map(info?.groups.map((group) => [group.id, group]));
  const presets = info ? layerPresets(source, info) : [];
  const selected = presets.find(preset => preset.id === presetId);
  const custom = source.layerPresets?.find(preset => preset.id === presetId);
  const savePreset = async (overwrite: boolean) => {
    if (!info) return;
    const result = await prompt.ask({ title: overwrite ? "表示プリセットを上書き" : "表示プリセットを作成",
      message: "現在の表示状態を保存します。", fields: [{ key: "name", label: "プリセット名", value: overwrite ? custom?.name : "新しい表示設定" }] });
    if (!result) return;
    try {
      const id = overwrite ? presetId : `custom:${uid()}`;
      documentStore.execute(saveLayerPreset(source.id, result.name, info, id));
      setPresetId(id); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "プリセットを保存できません。"); }
  };
  return <section className="source-layers" aria-label={`${source.name}のレイヤー`}>
    <h3 title={source.name}>{source.name}</h3>
    {!info && !error && <p role="status">レイヤーを読み込み中…</p>}
    {error && <p role="alert">{error}</p>}
    {info && !info.groups.length && <p>このPDFにはレイヤーがありません。</p>}
    {!!info?.groups.length && <div className="layer-presets">
      <label>表示プリセット<select aria-label={`${source.name}の表示プリセット`} value={selected ? presetId : ""} onChange={event => setPresetId(event.target.value)}>
        <option value="">選択してください</option>
        {presets.map((preset, index) => <option key={preset.id} value={preset.id} disabled={!!preset.error}>{index + 1}. {preset.name}{preset.error ? "（未対応）" : ""}</option>)}
      </select></label>
      <button disabled={!selected || !!selected.error} onClick={() => {
        try { documentStore.execute(applyLayerPreset(source.id, presetId, info)); setError(""); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "プリセットを適用できません。"); }
      }}>プリセットを適用</button>
      <button onClick={() => void savePreset(false)}>現在の表示をプリセットに保存</button>
      <button disabled={!custom} onClick={() => void savePreset(true)}>選択プリセットを上書き</button>
      <button disabled={!custom} onClick={() => void (async () => {
        const result = await prompt.ask({ title: "表示プリセットを削除", message: `「${custom?.name}」を削除します。`, confirm: "削除", danger: true });
        if (!result) return;
        documentStore.execute(deleteLayerPreset(source.id, presetId)); setPresetId(""); setError("");
      })()}>選択プリセットを削除</button>
      <p className="hint">表示状態を一括変更します。ロック・排他設定と現在の階層を保持します。</p>
      <p className="hint">作成したプリセットは上書き・削除できます。元PDFのプリセットは保持します。</p>
      {presets.filter(preset => preset.error).map(preset => <p className="hint" key={preset.id}>{preset.name}: {preset.error}</p>)}
    </div>}
    {!!info?.groups.length && <div className="layer-bulk" role="group" aria-label="レイヤーの一括表示操作">
      {([['show', 'すべて表示'], ['hide', 'すべて非表示'], ['invert', '表示を反転']] as const).map(([mode, label]) =>
        <button key={mode} disabled={info.groups.every(group => group.locked)} onClick={() => {
          try { documentStore.execute(setAllLayerVisibility(source.id, mode, info)); setError(""); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "表示を変更できません。"); }
        }}>{label}</button>)}
      <p className="hint">ロックされたレイヤーは保持します。排他設定と競合する場合は全件を中止します。</p>
    </div>}
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
