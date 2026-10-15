import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFString, type PDFDocument } from "pdf-lib";
import type { Command } from "../commands/history";
import type { LayerInfo } from "./model";
import { uid, type LayerSnapshot, type Source } from "../state/model";

export interface LayerPreset {
  id: string;
  name: string;
  base: "ON" | "OFF" | "Unchanged";
  visibility: Record<string, boolean>;
  error?: string;
}
const key = (value: string) => PDFName.of(value);
const refId = (ref: PDFRef) => `${ref.objectNumber}R${ref.generationNumber || ""}`;

export function layerPresets(source: Source, info: LayerInfo): LayerPreset[] {
  return [...(info.presets ?? []), ...(source.layerPresets ?? []).map(preset => ({ ...preset, base: "Unchanged" as const }))];
}

export function validateLayerSnapshots(presets: LayerSnapshot[], known: Set<string>, originalCount = 0, originalReferences = 0) {
  if (presets.length + originalCount > 100) throw Error("表示プリセットは元PDFの設定を含め100件までです。");
  const ids = new Set<string>();
  let remaining = 100000 - originalReferences;
  for (const preset of presets) {
    if (!/^custom:[\w-]{1,100}$/.test(preset.id) || ids.has(preset.id)) throw Error("表示プリセットのIDが不正です。");
    ids.add(preset.id);
    if (!preset.name.trim() || preset.name.length > 1000) throw Error("プリセット名は空でない1000文字以下にしてください。");
    const entries = Object.entries(preset.visibility);
    if (entries.length !== known.size || entries.some(([id, state]) => !known.has(id) || typeof state !== "boolean"))
      throw Error("表示プリセットのレイヤー参照が不正です。");
    remaining -= entries.length;
    if (remaining < 0) throw Error("表示プリセットの参照数が多すぎます。");
  }
}

/** Capture all source groups; applying one never changes another source's layers. */
export function saveLayerPreset(sourceId: string, name: string, info: LayerInfo, presetId = `custom:${uid()}`): Command {
  return { label: "レイヤーの表示プリセットを保存", apply(document) {
    const source = document.sources[sourceId];
    if (!source || !info.groups.length) throw Error("レイヤーが見つかりません。");
    if (info.presets?.some(preset => preset.id === "limit")) throw Error("表示プリセットは元PDFの設定を含め100件までです。");
    const preset = { id: presetId, name, visibility: Object.fromEntries(info.groups.map(group =>
      [group.id, source.layerVisibility?.[group.id] ?? group.visible])) };
    const previous = source.layerPresets?.find(item => item.id === presetId);
    const presets = previous ? source.layerPresets!.map(item => item.id === presetId ? preset : item) : [...(source.layerPresets ?? []), preset];
    validateLayerSnapshots(presets, new Set(info.groups.map(group => group.id)), info.presets?.length,
      info.presets?.reduce((total, preset) => total + Object.keys(preset.visibility).length, 0));
    if (previous?.name === name && info.groups.every(group => previous.visibility[group.id] === preset.visibility[group.id])) return document;
    return { ...document, sources: { ...document.sources, [sourceId]: { ...source, layerPresets: presets } } };
  } };
}

export function deleteLayerPreset(sourceId: string, presetId: string): Command {
  return { label: "レイヤーの表示プリセットを削除", apply(document) {
    const source = document.sources[sourceId];
    if (!source?.layerPresets?.some(preset => preset.id === presetId)) return document;
    return { ...document, sources: { ...document.sources, [sourceId]: { ...source,
      layerPresets: source.layerPresets.filter(preset => preset.id !== presetId) } } };
  } };
}

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
    const source = document.sources[sourceId], preset = source && layerPresets(source, info).find(item => item.id === presetId);
    if (!source || !preset) throw Error("表示プリセットが見つかりません。");
    if (preset.error) throw Error(preset.error);
    if (source.layerPresets?.some(item => item.id === presetId))
      validateLayerSnapshots(source.layerPresets, new Set(info.groups.map(group => group.id)));
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
