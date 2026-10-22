import { expect, it } from "vitest";
import { setAllLayerVisibility } from "../src/layers/bulk";
import { emptyDocument } from "../src/state/model";
import { History } from "../src/commands/history";
import type { LayerInfo } from "../src/layers/model";

function fixture() {
  const model = emptyDocument();
  model.sources.s = { id: "s", name: "layers.pdf", bytes: new Uint8Array() };
  model.sources.other = { id: "other", name: "other.pdf", bytes: new Uint8Array(), layerVisibility: { x: true } };
  const info: LayerInfo = { rows: [], groups: [
    { id: "a", name: "A", visible: true, locked: false, radioGroups: [] },
    { id: "b", name: "B", visible: false, locked: false, radioGroups: [] },
    { id: "locked", name: "Locked", visible: true, locked: true, radioGroups: [] },
  ] };
  return { model, info, history: new History(model) };
}

it("changes unlocked layers in one undo step, preserves other sources and avoids no-op history", () => {
  const { model, info, history } = fixture();
  history.execute(setAllLayerVisibility("s", "hide", info));
  expect(history.current.document.sources.s.layerVisibility).toEqual({ a: false });
  expect(history.current.document.sources.other).toBe(model.sources.other);
  const revision = history.current;
  history.execute(setAllLayerVisibility("s", "hide", info));
  expect(history.current).toBe(revision);
  history.undo(); expect(history.current.document).toBe(model); expect(history.dirty).toBe(false);
  history.redo(); expect(history.current).toBe(revision);
  history.execute(setAllLayerVisibility("s", "invert", info));
  expect(history.current.document.sources.s.layerVisibility).toEqual({ b: true });
});

it("rejects radio conflicts atomically, including conflicts with locked visible layers", () => {
  const { model, info, history } = fixture();
  info.groups[1].radioGroups = [["b", "locked"]];
  expect(() => history.execute(setAllLayerVisibility("s", "show", info))).toThrow(/排他/);
  expect(() => history.execute(setAllLayerVisibility("s", "invert", info))).toThrow(/排他/);
  expect(history.current.document).toBe(model); expect(history.canUndo).toBe(false); expect(history.dirty).toBe(false);
  history.execute(setAllLayerVisibility("s", "hide", info));
  expect(history.current.document.sources.s.layerVisibility).toEqual({ a: false });
});
