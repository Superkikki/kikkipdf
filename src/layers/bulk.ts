import type { Command } from "../commands/history";
import type { LayerInfo } from "./model";

export function setAllLayerVisibility(sourceId: string, mode: "show" | "hide" | "invert", info: LayerInfo): Command {
  return { label: mode === "invert" ? "レイヤー表示を反転" : mode === "show" ? "レイヤーを一括表示" : "レイヤーを一括非表示",
    apply(document) {
      const source = document.sources[sourceId];
      if (!source) throw Error("参照元PDFがありません。");
      const current = (id: string, initial: boolean) => source.layerVisibility?.[id] ?? initial;
      const states = new Map(info.groups.map(group => [group.id, group.locked ? current(group.id, group.visible)
        : mode === "invert" ? !current(group.id, group.visible) : mode === "show"]));
      for (const group of info.groups) for (const radio of group.radioGroups)
        if (radio.filter(id => states.get(id)).length > 1)
          throw Error("排他グループの複数レイヤーを表示するため、一括変更できません。個別に表示を選んでください。");
      if (info.groups.every(group => states.get(group.id) === current(group.id, group.visible))) return document;
      const layerVisibility = Object.fromEntries(info.groups.filter(group => states.get(group.id) !== group.visible)
        .map(group => [group.id, states.get(group.id)!]));
      return { ...document, sources: { ...document.sources, [sourceId]: { ...source, layerVisibility } } };
    } };
}
