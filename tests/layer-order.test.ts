import { expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { importPdf, releasePdfs } from "../src/viewer/pdf";
import { readLayers } from "../src/layers/model";
import { addLayerHeading, moveLayerNode, parseLayerOrder, removeLayerHeading, renameLayerHeading, resetLayerOrder } from "../src/layers/order";
import { layerGroupIds, readLayerOrder } from "../src/layers/pdfOrder";
import { History } from "../src/commands/history";
import { saveProject, openProject } from "../src/state/project";
import { exportPdf } from "../src/export/engine";
import { mergeDocuments } from "../src/commands/document";
import type { LayerOrderNode } from "../src/state/model";
GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;
const N = (name: string) => PDFName.of(name);
async function fixture() {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const groups = ["A", "B", "C"].map(name => pdf.context.register(pdf.context.obj({ Type: "OCG", Name: PDFString.of(name) })));
  pdf.catalog.set(N("OCProperties"), pdf.context.obj({ OCGs: groups,
    D: { Order: [[PDFString.of("Original"), groups[0], [PDFString.of("Sub"), groups[1]]], groups[2]],
      BaseState: "ON", OFF: [groups[1]], Locked: [groups[0]], RBGroups: [[groups[0], groups[1]]] } }));
  const model = await importPdf({ name: "layers.pdf", bytes: await pdf.save() }), source = Object.values(model.sources)[0], info = await readLayers(source);
  return { model, source, info };
}

it("organizes layers under nested named headings with atomic undo, preserves locks/states, and saves project/PDF/merged sources", async () => {
  const { model, source, info } = await fixture(), h = new History(model), original = structuredClone(info.order);
  expect(info.orderError).toBeUndefined();
  h.execute(addLayerHeading(source.id, "日本語の見出し", info, "heading:new"));
  h.execute(moveLayerNode(source.id, `group:${info.groups[2].id}`, "heading:new", undefined, info));
  h.execute(moveLayerNode(source.id, "heading:new", "heading:1", 0, info));
  const beforeRename = h.current;
  h.execute(renameLayerHeading(source.id, "heading:new", "更新した見出し", info));
  h.undo(); expect(h.current).toBe(beforeRename); h.redo();
  const current = h.current;
  h.execute(renameLayerHeading(source.id, "heading:new", "更新した見出し", info)); expect(h.current).toBe(current);
  expect(info.order).toEqual(original); expect(source.layerOrder).toBeUndefined();
  expect(h.current.document.sources[source.id].layerVisibility).toBeUndefined();
  const restored = await openProject(await saveProject(h.current.document));
  expect(restored.sources[source.id].layerOrder).toEqual(current.document.sources[source.id].layerOrder);
  const output = await PDFDocument.load(await exportPdf(restored));
  const order = readLayerOrder(output, new Set(layerGroupIds(output)));
  expect(order[0].title).toBe("Original"); expect(order[0].children[0].title).toBe("更新した見出し");
  expect(order[0].children[0].children).toHaveLength(1);
  const config = output.catalog.lookup(N("OCProperties"), PDFDict).lookup(N("D"), PDFDict);
  expect(config.lookup(N("Locked"), PDFArray).size()).toBe(1); expect(config.lookup(N("RBGroups"), PDFArray).size()).toBe(1);
  expect(config.lookup(N("OFF"), PDFArray).size()).toBe(1);
  const other = await fixture(), merged = mergeDocuments(other.model).apply(restored);
  expect(merged.sources[Object.keys(other.model.sources)[0]]).toBe(other.source);
  const both = await PDFDocument.load(await exportPdf(merged));
  expect(layerGroupIds(both)).toHaveLength(6); expect(readLayerOrder(both, new Set(layerGroupIds(both)))).toHaveLength(3);
  h.execute(removeLayerHeading(source.id, "heading:new", info));
  expect(h.current.document.sources[source.id].layerOrder![0].children[0].groupId).toBe(info.groups[2].id);
  h.execute(resetLayerOrder(source.id)); expect(h.current.document.sources[source.id].layerOrder).toBeUndefined();
  const clean = h.current; h.execute(resetLayerOrder(source.id)); expect(h.current).toBe(clean);
  releasePdfs();
});

it("rejects cycles, unknown/missing/duplicate references, invalid titles and excessive depth without altering history", async () => {
  const { model, source, info } = await fixture(), h = new History(model);
  expect(() => h.execute(moveLayerNode(source.id, "heading:1", "heading:2", undefined, info))).toThrow(/移動先/);
  expect(() => h.execute(moveLayerNode(source.id, "heading:1", `group:${info.groups[0].id}`, 0, info))).toThrow(/移動先/);
  expect(() => h.execute(addLayerHeading(source.id, " ", info))).toThrow(/見出し/);
  expect(h.current.document).toBe(model); expect(h.canUndo).toBe(false);
  const known = new Set(info.groups.map(group => group.id));
  expect(() => parseLayerOrder([], known)).toThrow(/参照/);
  expect(() => parseLayerOrder([{ key: "group:999R", groupId: "999R", children: [] }], known)).toThrow(/参照/);
  expect(() => parseLayerOrder([info.order![0], info.order![0]], known)).toThrow();
  let deep: LayerOrderNode[] = [{ key: `group:${info.groups[0].id}`, groupId: info.groups[0].id, children: [] }];
  for (let i = 0; i < 12; i++) deep = [{ key: `heading:depth${i}`, title: "Deep", children: deep }];
  expect(() => parseLayerOrder(deep)).toThrow(/12段/);
  const bad = structuredClone(model); bad.sources[source.id].layerOrder = [];
  await expect(exportPdf(bad)).rejects.toThrow(/参照/); await expect(saveProject(bad)).rejects.toThrow(/参照/);
  const files = unzipSync(await saveProject(model)), manifest = JSON.parse(strFromU8(files["document.json"]));
  manifest.document.sources[source.id].layerOrder = [{ key: "group:999R", groupId: "999R", children: [] }];
  files["document.json"] = strToU8(JSON.stringify(manifest)); await expect(openProject(zipSync(files))).rejects.toThrow();
  releasePdfs();
});

it("keeps complex original order readable while refusing hierarchy edits, and accepts exactly twelve levels", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const a = pdf.context.register(pdf.context.obj({ Type: "OCG", Name: PDFString.of("Parent") })),
    b = pdf.context.register(pdf.context.obj({ Type: "OCG", Name: PDFString.of("Child") }));
  pdf.catalog.set(N("OCProperties"), pdf.context.obj({ OCGs: [a, b], D: { Order: [a, [b]] } }));
  const model = await importPdf({ name: "complex.pdf", bytes: await pdf.save() }), source = Object.values(model.sources)[0], info = await readLayers(source);
  expect(info.groups).toHaveLength(2); expect(info.orderError).toMatch(/複雑/);
  const h = new History(model); expect(() => h.execute(addLayerHeading(source.id, "Heading", info))).toThrow(/複雑/); expect(h.canUndo).toBe(false);
  const saved = await PDFDocument.load(await exportPdf(model)), order = saved.catalog.lookup(N("OCProperties"), PDFDict).lookup(N("D"), PDFDict).lookup(N("Order"), PDFArray);
  expect(order.size()).toBe(2); expect(order.lookup(1, PDFArray).size()).toBe(1);
  let deep: LayerOrderNode[] = [];
  for (let i = 0; i < 12; i++) deep = [{ key: `heading:boundary${i}`, title: "Heading", children: deep }];
  expect(parseLayerOrder(deep)).toEqual(deep);
  releasePdfs();
});
