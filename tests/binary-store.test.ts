import { expect, it } from "vitest";
import { BinaryStore, restoreBinaries, separateBinaries } from "../src/state/binaryStore";
import { blankPage, emptyDocument } from "../src/state/model";

it("separates every binary kind from edits and restores shared identities", () => {
  const document = emptyDocument(), bytes = new Uint8Array([1, 2, 255]);
  document.pages = [blankPage()];
  document.sources.s = { id: "s", name: "pdf", bytes };
  document.images.i = { id: "i", mime: "image/png", bytes };
  document.fonts = { f: { id: "f", family: "test", name: "test", format: "ttf", bytes } };
  document.attachments = [{ id: "a", name: "a", description: "", bytes }];
  const packed = separateBinaries(document);
  expect(packed.binaries.size).toBe(1);
  expect(JSON.stringify(packed.value)).not.toContain('"255"');
  const store = new BinaryStore(); store.register(Object.fromEntries(packed.binaries));
  const restored = restoreBinaries<typeof document>(packed.value, store.get);
  expect(restored).toEqual(document);
  expect(restored.sources.s.bytes).toBe(restored.images.i.bytes);
  const next = separateBinaries({ ...restored, pages: [{ ...restored.pages[0], rotation: 90 }] });
  expect([...next.binaries.keys()]).toEqual([...packed.binaries.keys()]);
});

it("keeps distinct views of the same buffer distinct", () => {
  const buffer = new Uint8Array([10, 20, 30]);
  const input = [buffer.subarray(0, 2), buffer.subarray(1)];
  const packed = separateBinaries(input);
  expect(packed.binaries.size).toBe(2);
  expect(restoreBinaries<typeof input>(packed.value, id => packed.binaries.get(id)!)).toEqual(input);
});

it("does not reuse an identity when an immutable asset is replaced", () => {
  const old = separateBinaries({ bytes: new Uint8Array([1]) });
  const next = separateBinaries({ bytes: new Uint8Array([2]) });
  expect(next.value.bytes.$binary).not.toBe(old.value.bytes.$binary);
});

it("evicts unreferenced bytes and rejects incomplete snapshots", () => {
  const store = new BinaryStore();
  const a = new Uint8Array([1]), b = new Uint8Array([2]);
  store.register({ a, b }); store.retain(new Set(["b"]));
  expect(store.owns(a.buffer)).toBe(false);
  expect(store.owns(b.buffer)).toBe(true);
  expect(() => restoreBinaries<Uint8Array>({ $binary: "a" }, store.get)).toThrow();
});
