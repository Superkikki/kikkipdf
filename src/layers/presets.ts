import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFString, type PDFDocument } from "pdf-lib";
import type { Command } from "../commands/history";
import type { LayerInfo } from "./model";

export interface LayerPreset {
  id: string;
  name: string;
  base: "ON" | "OFF" | "Unchanged";
  visibility: Record<string, boolean>;
  error?: string;
}
const key = (value: string) => PDFName.of(value);
const refId = (ref: PDFRef) => `${ref.objectNumber}R${ref.generationNumber || ""}`;

/** Display presets apply states; the original configuration dictionaries remain intact. */
export function readLayerPresets(pdf: PDFDocument, known: Set<string>): LayerPreset[] {
  const properties = pdf.catalog.lookupMaybe(key("OCProperties"), PDFDict);
  const configs = properties?.lookupMaybe(key("Configs"), PDFArray);
  if (!configs) return [];
  if (configs.size() > 100) return [{ id: "limit", name: "表示プリセット", base: "ON", visibility: {}, error: "表示プリセットは100件まで対応しています。" }];
  let remaining = 100000;
  return configs.asArray().map((ref, index) => {
    const preset: LayerPreset = { id: String(index), name: `表示設定 ${index + 1}`, base: "ON", visibility: {} };
    try {
      const config = pdf.context.lookup(ref, PDFDict);
      const name = pdf.context.lookup(config.get(key("Name")));
      if (name instanceof PDFString || name instanceof PDFHexString) preset.name = name.decodeText();
      if (preset.name.length > 1000) throw Error("表示プリセット名が長すぎます。");
      const base = config.lookupMaybe(key("BaseState"), PDFName)?.decodeText() ?? "ON";
      if (!["ON", "OFF", "Unchanged"].includes(base)) throw Error("BaseStateが不正です。");
      preset.base = base as LayerPreset["base"];
      const automatic = config.lookupMaybe(key("AS"), PDFArray);
      if (automatic?.size()) throw Error("自動表示条件（AS）を持つプリセットは未対応です。");
      const intent = pdf.context.lookup(config.get(key("Intent")));
      const intents = intent instanceof PDFArray ? intent.asArray().map(value => pdf.context.lookup(value)) : intent ? [intent] : [];
      if (intents.some(value => value !== key("View"))) throw Error("View以外のIntentを持つプリセットは未対応です。");
      for (const [name, state] of [["ON", true], ["OFF", false]] as const) {
        const refs = config.lookupMaybe(key(name), PDFArray);
        for (const group of refs?.asArray() ?? []) {
          if (--remaining < 0) throw Error("表示プリセットの参照数が多すぎます。");
          if (!(group instanceof PDFRef) || !known.has(refId(group))) throw Error("表示プリセットのレイヤー参照が不正です。");
          const id = refId(group);
          if (id in preset.visibility) throw Error("表示プリセットのON／OFF指定が重複しています。");
          preset.visibility[id] = state;
        }
      }
    } catch (reason) {
      preset.error = reason instanceof Error ? reason.message : "表示プリセットを読み込めません。";
    }
    return preset;
  });
}

export function applyLayerPreset(sourceId: string, presetId: string, info: LayerInfo): Command {
  return { label: "レイヤーの表示プリセットを適用", apply(document) {
    const source = document.sources[sourceId], preset = info.presets?.find(item => item.id === presetId);
    if (!source || !preset) throw Error("表示プリセットが見つかりません。");
    if (preset.error) throw Error(preset.error);
    const states = new Map(info.groups.map(group => [group.id, preset.visibility[group.id] ??
      (preset.base === "Unchanged" ? source.layerVisibility?.[group.id] ?? group.visible : preset.base === "ON")]));
    for (const group of info.groups) {
      if (group.locked && states.get(group.id) !== (source.layerVisibility?.[group.id] ?? group.visible))
        throw Error(`ロックされたレイヤーを変更するプリセットは適用できません: ${group.name}`);
      for (const radio of group.radioGroups)
        if (radio.filter(id => states.get(id)).length > 1) throw Error("排他グループの複数レイヤーを表示するプリセットは適用できません。");
    }
    if (info.groups.every(group => states.get(group.id) === (source.layerVisibility?.[group.id] ?? group.visible))) return document;
    const layerVisibility = Object.fromEntries(info.groups.filter(group => states.get(group.id) !== group.visible).map(group => [group.id, states.get(group.id)!]));
    return { ...document, sources: { ...document.sources, [sourceId]: { ...source, layerVisibility } } };
  } };
}
