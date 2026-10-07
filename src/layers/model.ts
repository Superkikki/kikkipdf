import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Command } from "../commands/history";
import type { Source } from "../state/model";
import { sourcePdf } from "../viewer/pdf";
import { readLayerPresets, type LayerPreset } from "./presets";

export interface LayerGroup {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  radioGroups: string[][];
}
export interface LayerRow { id?: string; name: string; depth: number }
export interface LayerInfo { groups: LayerGroup[]; rows: LayerRow[]; presets?: LayerPreset[] }
export const layerRefId = (ref: PDFRef) => `${ref.objectNumber}R${ref.generationNumber || ""}`;
const cache = new WeakMap<Uint8Array, Promise<LayerInfo>>();

export function readLayers(source: Source): Promise<LayerInfo> {
  let ready = cache.get(source.bytes);
  if (!ready) {
    ready = (async () => {
      const [pdf, raw] = await Promise.all([sourcePdf(source), PDFDocument.load(source.bytes)]);
      const config = await pdf.getOptionalContentConfig();
      const properties = raw.catalog.lookupMaybe(PDFName.of("OCProperties"), PDFDict);
      const locked = properties?.lookupMaybe(PDFName.of("D"), PDFDict)?.lookupMaybe(PDFName.of("Locked"), PDFArray);
      const lockedIds = new Set(locked?.asArray().filter((r): r is PDFRef => r instanceof PDFRef).map(layerRefId));
      const groups: LayerGroup[] = [...config].map(([id, group]) => ({
        id: String(id), name: String(group.name ?? "名称なし"), visible: !!group.visible,
        locked: lockedIds.has(String(id)),
        radioGroups: (group.rbGroups as Set<string>[]).map((set) => [...set]),
      }));
      if (groups.length > 10_000) throw Error("レイヤーは10,000件まで対応しています。");
      const byId = new Map(groups.map((group) => [group.id, group]));
      const rows: LayerRow[] = [], seen = new Set<string>();
      function walk(order: unknown, depth: number) {
        if (!Array.isArray(order) || depth > 12) return;
        for (const item of order) {
          if (typeof item === "string" && byId.has(item) && !seen.has(item)) {
            seen.add(item);
            rows.push({ id: item, name: byId.get(item)!.name, depth });
          } else if (item && typeof item === "object" && "order" in item && "name" in item) {
            rows.push({ name: String(item.name), depth });
            walk(item.order, depth + 1);
          }
        }
      }
      walk(config.getOrder(), 0);
      for (const group of groups) if (!seen.has(group.id)) rows.push({ id: group.id, name: group.name, depth: 0 });
      return { groups, rows, presets: readLayerPresets(raw, new Set(groups.map(group => group.id))) };
    })();
    cache.set(source.bytes, ready);
    ready.catch(() => cache.delete(source.bytes));
  }
  return ready;
}

export async function layerConfig(pdf: PDFDocumentProxy, overrides?: Record<string, boolean>) {
  const config = await pdf.getOptionalContentConfig();
  for (const [id, visible] of Object.entries(overrides ?? {}))
    config.setVisibility(id, visible, false);
  return config;
}

export function setLayerVisibility(sourceId: string, id: string, visible: boolean, info: LayerInfo): Command {
  return {
    label: "レイヤーの表示を変更",
    apply(document) {
      const source = document.sources[sourceId];
      const group = info.groups.find((item) => item.id === id);
      if (!source || !group) throw Error("レイヤーが見つかりません。");
      if (group.locked) throw Error("このレイヤーは表示がロックされています。");
      const state = new Map(info.groups.map((item) => [item.id, source.layerVisibility?.[item.id] ?? item.visible]));
      if (state.get(id) === visible) return document;
      if (visible) for (const radio of group.radioGroups) for (const peer of radio) {
        if (peer === id) continue;
        if (state.get(peer) && info.groups.find((item) => item.id === peer)?.locked)
          throw Error("排他グループのレイヤーがロックされています。");
        if (state.has(peer)) state.set(peer, false);
      }
      state.set(id, visible);
      const layerVisibility = Object.fromEntries(info.groups
        .filter((item) => state.get(item.id) !== item.visible)
        .map((item) => [item.id, state.get(item.id)!]));
      return { ...document, sources: { ...document.sources, [sourceId]: { ...source, layerVisibility } } };
    },
  };
}

export function resetLayerVisibility(sourceId: string): Command {
  return {
    label: "レイヤーを初期表示に戻す",
    apply(document) {
      const source = document.sources[sourceId];
      if (!source || !Object.keys(source.layerVisibility ?? {}).length) return document;
      const restored = { ...source };
      delete restored.layerVisibility;
      return { ...document, sources: { ...document.sources, [sourceId]: restored } };
    },
  };
}
