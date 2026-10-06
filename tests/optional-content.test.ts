import { describe, expect, it } from "vitest";
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFObjectCopier, PDFString,
} from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { importPdf, releasePdfs } from "../src/viewer/pdf";
import { exportPdf, inspectForms } from "../src/export/engine";
import { mergeDocuments, duplicatePage } from "../src/commands/document";
import { OptionalContentSource } from "../src/export/optionalContent";
import { renameLayer, resetLayerNames } from "../src/layers/commands";
import { readLayers, resetLayerVisibility, setLayerVisibility } from "../src/layers/model";
import { History } from "../src/commands/history";
import { saveProject, openProject } from "../src/state/project";

GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;
const N = (value: string) => PDFName.of(value);

async function layeredPdf(
  options: { base?: "ON" | "OFF" | "Unchanged"; off?: number[]; viewOff?: number[]; configs?: boolean; count?: number } = {},
) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const groups = Array.from({ length: options.count ?? 2 }, (_, i) => {
    const group = pdf.context.register(pdf.context.obj({
      Type: "OCG", Name: PDFString.of(`Shared name ${i}`), Intent: ["View"],
      Usage: { View: { ViewState: options.viewOff?.includes(i) ? "OFF" : "ON" }, Print: { PrintState: "ON" } },
    }));
    return group;
  });
  const properties = pdf.context.obj({});
  groups.forEach((group, i) => properties.set(N(`L${i}`), group));
  const membership = pdf.context.register(pdf.context.obj({ Type: "OCMD", OCGs: groups, P: "AllOn" }));
  properties.set(N("Membership"), membership);
  const resources = pdf.context.obj({ Properties: properties });
  page.node.set(N("Resources"), resources);
  page.node.set(N("Contents"), pdf.context.register(pdf.context.flateStream(
    [...groups.map((_, i) => `/OC /L${i} BDC 0 0 m 10 10 l S EMC`), "/OC /Membership BDC 0 0 m 10 10 l S EMC"].join("\n"),
  )));
  const order = pdf.context.obj([groups[0], pdf.context.obj([pdf.context.obj([PDFString.of("nested"), groups[1]])])]);
  const d = pdf.context.obj({
    Name: PDFString.of("Main view"), Creator: PDFString.of("fixture"), BaseState: options.base ?? "ON",
    ON: pdf.context.obj(groups.filter((_, i) => !options.off?.includes(i))),
    OFF: pdf.context.obj(groups.filter((_, i) => options.off?.includes(i))),
    Intent: ["View"], Order: order, ListMode: "VisiblePages",
    Locked: [groups[1]], RBGroups: [[groups[0], groups[1]]],
    AS: [{ Event: "View", Category: ["View"], OCGs: groups }],
  });
  const config = pdf.context.obj({ Name: PDFString.of("Print preset"), BaseState: "OFF", ON: [groups[1]], Intent: ["View"] });
  pdf.catalog.set(N("OCProperties"), pdf.context.register(pdf.context.obj({
    OCGs: groups,
    D: pdf.context.register(d),
    ...(options.configs === false ? {} : { Configs: [pdf.context.register(config)] }),
  })));
  return { bytes: await pdf.save(), groups };
}

async function loadExport(model: Awaited<ReturnType<typeof importPdf>>) {
  const bytes = await exportPdf(model);
  return PDFDocument.load(bytes);
}

function catalog(pdf: PDFDocument) {
  const oc = pdf.context.lookup(pdf.catalog.get(N("OCProperties")), PDFDict);
  const groups = oc.lookup(N("OCGs"), PDFArray);
  const config = oc.lookup(N("D"), PDFDict);
  return { oc, groups, config };
}

describe("PDF optional content layers", () => {
  it("exports a visible override against a Usage ViewState OFF default", async () => {
    const fixture = await layeredPdf({ count: 1, viewOff: [0] });
    const model = await importPdf({ name: "usage-view-off.pdf", bytes: fixture.bytes });
    const source = Object.values(model.sources)[0];
    const info = await readLayers(source);
    expect(info.groups[0].visible).toBe(false);
    const changed = setLayerVisibility(source.id, info.groups[0].id, true, info).apply(model);
    const output = await PDFDocument.load(await exportPdf(changed));
    const loading = getDocument({ data: await output.save() });
    const parsed = await loading.promise;
    const optional = await parsed.getOptionalContentConfig();
    expect(optional.isVisible({ type: "OCG", id: info.groups[0].id })).toBe(true);
    await loading.destroy();
    releasePdfs();
  });

  it("inspects imported form widget optional-content membership", async () => {
    const fixture = await layeredPdf();
    const input = await PDFDocument.load(fixture.bytes);
    const oc = input.context.lookup(input.catalog.get(N("OCProperties"))!, PDFDict);
    const group = oc.lookup(N("OCGs"), PDFArray).get(0);
    const field = input.getForm().createTextField("Layer field");
    field.addToPage(input.getPage(0), { x: 40, y: 40, width: 180, height: 24 });
    field.acroField.getWidgets()[0].dict.set(N("OC"), group);
    const model = await importPdf({ name: "layered-form.pdf", bytes: await input.save() });
    const descriptor = (await inspectForms(model)).find((item) => item.name === "Layer field");
    const layer = (await readLayers(Object.values(model.sources)[0])).groups[0];
    expect(descriptor?.widgets[0].optionalContent).toEqual({ type: "OCG", id: layer.id });
    releasePdfs();
  });

  it("reads effective defaults, lock and radio groups; records reversible overrides and project state", async () => {
    const fixture = await layeredPdf();
    const model = await importPdf({ name: "layers.pdf", bytes: fixture.bytes });
    const source = Object.values(model.sources)[0];
    const info = await readLayers(source);
    expect(info.groups).toHaveLength(2);
    const [first, second] = info.groups;
    expect(first.visible).toBe(true);
    expect(second.visible).toBe(true);
    expect(second.locked).toBe(true);
    expect(first.radioGroups).toContainEqual([first.id, second.id]);
    expect(info.rows.some((row) => row.id === first.id)).toBe(true);

    const history = new History(model);
    const originalBytes = source.bytes.slice();
    history.execute(setLayerVisibility(source.id, first.id, false, info));
    expect(history.current.document.sources[source.id].layerVisibility).toEqual({ [first.id]: false });
    expect(history.current.document.sources[source.id].bytes).toEqual(originalBytes);
    const restored = await openProject(await saveProject(history.current.document));
    expect(restored.sources[source.id].layerVisibility).toEqual({ [first.id]: false });
    history.undo();
    expect(history.current.document.sources[source.id].layerVisibility).toBeUndefined();
    history.redo();
    expect(history.current.document.sources[source.id].layerVisibility).toEqual({ [first.id]: false });
    history.execute(resetLayerVisibility(source.id));
    expect(history.current.document.sources[source.id].layerVisibility).toBeUndefined();
    const firstOff = setLayerVisibility(source.id, first.id, false, info).apply(model);
    expect(() => setLayerVisibility(source.id, first.id, true, info).apply(firstOff)).toThrow("排他グループ");
    expect(() => setLayerVisibility(source.id, second.id, false, info).apply(model)).toThrow("ロック");
    releasePdfs();
  });

  it("preserves the single-source configuration and shares its OCGs with page properties", async () => {
    const source = await layeredPdf({ base: "OFF", off: [1] });
    const model = await importPdf({ name: "single.pdf", bytes: source.bytes });
    const output = await loadExport(model);
    const { oc, groups, config } = catalog(output);
    expect(groups.size()).toBe(2);
    expect(config.lookup(N("BaseState"))!.toString()).toBe("/OFF");
    expect(config.has(N("Name"))).toBe(true);
    expect(config.has(N("Creator"))).toBe(true);
    for (const key of ["Order", "AS", "Locked", "RBGroups", "Intent", "ON", "OFF"])
      expect(config.has(N(key))).toBe(true);
    expect(oc.lookup(N("Configs"), PDFArray).size()).toBe(1);
    const order = config.lookup(N("Order"), PDFArray);
    expect(order.get(0)).toBe(groups.get(0));
    const nestedOrder = output.context.lookup(order.get(1), PDFArray);
    expect(output.context.lookup(nestedOrder.get(0), PDFArray).get(1)).toBe(groups.get(1));
    const locked = config.lookup(N("Locked"), PDFArray);
    expect(locked.get(0)).toBe(groups.get(1));
    const radioGroups = output.context.lookup(config.lookup(N("RBGroups"), PDFArray).get(0), PDFArray);
    expect(radioGroups.asArray()).toEqual(groups.asArray());
    const usageApplication = output.context.lookup(config.lookup(N("AS"), PDFArray).get(0), PDFDict);
    expect(usageApplication.lookup(N("OCGs"), PDFArray).asArray()).toEqual(groups.asArray());
    const page = output.getPage(0);
    const pageResources = page.node.Resources()!;
    const props = pageResources.lookup(N("Properties"), PDFDict);
    const markedGroup = props.get(N("L1"));
    const catalogGroup = groups.asArray().find((ref) => {
      const item = output.context.lookup(ref, PDFDict);
      return item.lookup(N("Name"), PDFString).decodeText() === "Shared name 1";
    });
    expect(markedGroup).toBe(catalogGroup);
    const membership = output.context.lookup(props.get(N("Membership"))!, PDFDict);
    expect(membership.lookup(N("OCGs"), PDFArray).asArray()).toEqual(groups.asArray());
    const loading = getDocument({ data: await output.save() });
    const parsed = await loading.promise;
    const optional = await parsed.getOptionalContentConfig();
    const hidden = [...optional].find(([, group]) => group.name === "Shared name 1");
    expect(hidden).toBeDefined();
    expect(optional.isVisible({ type: "OCG", id: hidden![0] })).toBe(false);
    expect(optional.isVisible({ type: "OCMD", ids: [...optional].map(([id]) => id), policy: "AllOn" })).toBe(false);
    await loading.destroy();
    releasePdfs();
  });

  it("retains BaseState Unchanged, nested order, usage and alternate configs for one source", async () => {
    const source = await layeredPdf({ base: "Unchanged", off: [], count: 2 });
    const model = await importPdf({ name: "unchanged.pdf", bytes: source.bytes });
    const output = await loadExport(model);
    const { config } = catalog(output);
    expect(config.lookup(N("BaseState"))!.toString()).toBe("/Unchanged");
    expect(config.has(N("Usage"))).toBe(false); // Usage belongs to each OCG.
    const ocg = output.context.lookup(catalog(output).groups.get(0), PDFDict);
    expect(ocg.has(N("Usage"))).toBe(true);
    expect(config.lookup(N("Order"), PDFArray).size()).toBeGreaterThan(1);
    const loading = getDocument({ data: await output.save() });
    const parsed = await loading.promise;
    const optional = await parsed.getOptionalContentConfig();
    for (const [id] of optional) expect(optional.isVisible({ type: "OCG", id })).toBe(true);
    await loading.destroy();
    releasePdfs();
  });

  it("merges same-named layers as distinct groups with each source's effective default state", async () => {
    const visible = await importPdf({ name: "on.pdf", bytes: (await layeredPdf({ off: [] })).bytes });
    const offSource = await PDFDocument.load((await layeredPdf({ base: "OFF", off: [0, 1] })).bytes);
    const offProperties = offSource.context.lookup(offSource.catalog.get(N("OCProperties"))!, PDFDict);
    const offConfig = offSource.context.lookup(offProperties.get(N("D"))!, PDFDict);
    offConfig.delete(N("ON"));
    offConfig.delete(N("OFF"));
    const hidden = await importPdf({ name: "off.pdf", bytes: await offSource.save() });
    const merged = mergeDocuments(hidden).apply(visible);
    const output = await loadExport(merged);
    const { groups, config } = catalog(output);
    expect(groups.size()).toBe(4);
    expect(config.lookup(N("BaseState"))!.toString()).toBe("/ON");
    expect(config.lookup(N("ON"), PDFArray).size()).toBe(2);
    expect(config.lookup(N("OFF"), PDFArray).size()).toBe(2);
    expect(catalog(output).oc.has(N("Configs"))).toBe(false);
    const refs = groups.asArray();
    expect(new Set(refs.map(String)).size).toBe(4);
    const loading = getDocument({ data: await output.save() });
    const parsed = await loading.promise;
    const optional = await parsed.getOptionalContentConfig();
    const visibleGroups = [...optional].filter(([id]) => optional.isVisible({ type: "OCG", id }));
    expect(visibleGroups).toHaveLength(2);
    await loading.destroy();
    releasePdfs();
  });

  it("exports only layers referenced by selected pages and shares groups on duplication", async () => {
    const fixture = await layeredPdf({ count: 2 });
    const source = await PDFDocument.load(fixture.bytes);
    source.addPage();
    const model = await importPdf({ name: "two-pages.pdf", bytes: await source.save() });
    const duplicated = duplicatePage(model.pages[0].id).apply(model);
    const one = await PDFDocument.load(await exportPdf(duplicated, undefined, { indices: [0, 1] }));
    const first = catalog(one);
    expect(first.groups.size()).toBe(2);
    const firstProperties = one.getPage(0).node.Resources()!.lookup(N("Properties"), PDFDict);
    const secondProperties = one.getPage(1).node.Resources()!.lookup(N("Properties"), PDFDict);
    expect(firstProperties.get(N("L0"))).toBe(secondProperties.get(N("L0")));
    const plain = await PDFDocument.create();
    plain.addPage();
    const plainModel = await importPdf({ name: "plain.pdf", bytes: await plain.save() });
    const withPlainPage = mergeDocuments(plainModel).apply(model);
    const extracted = await PDFDocument.load(await exportPdf(withPlainPage, undefined, { indices: [2] }));
    expect(extracted.catalog.has(N("OCProperties"))).toBe(false);
    releasePdfs();
  });

  it("keeps an imported widget's optional-content reference shared with the catalog", async () => {
    const source = await layeredPdf({ base: "ON", off: [0] });
    const input = await PDFDocument.load(source.bytes);
    const field = input.getForm().createTextField("Layered field");
    field.addToPage(input.getPage(0), { x: 40, y: 40, width: 180, height: 24 });
    field.acroField.getWidgets()[0].dict.set(N("OC"), source.groups[0]);
    const model = await importPdf({ name: "layered-form.pdf", bytes: await input.save() });
    const output = await PDFDocument.load(await exportPdf(model));
    const { groups, config } = catalog(output);
    const widget = output.getForm().getTextField("Layered field").acroField.getWidgets()[0].dict;
    expect(widget.get(N("OC"))).toBe(groups.get(0));
    const loading = getDocument({ data: await output.save() });
    const parsed = await loading.promise;
    const optional = await parsed.getOptionalContentConfig();
    const hiddenId = [...optional].find(([, group]) => group.name === "Shared name 0")?.[0];
    expect(hiddenId).toBeDefined();
    expect(optional.isVisible({ type: "OCG", id: hiddenId })).toBe(false);
    expect(config.lookup(N("OFF"), PDFArray).size()).toBe(1);
    await loading.destroy();
    releasePdfs();
  });

  it("bounds malformed cyclic config graphs and excessive OCG counts", async () => {
    const input = await PDFDocument.create();
    const group = input.context.register(input.context.obj({ Type: "OCG", Name: PDFString.of("one") }));
    const cycle = input.context.obj([]);
    const cycleRef = input.context.register(cycle);
    cycle.push(cycleRef);
    input.catalog.set(N("OCProperties"), input.context.register(input.context.obj({
      OCGs: [group], D: input.context.register(input.context.obj({ Order: cycleRef })),
    })));
    const output = await PDFDocument.create();
    const copier = PDFObjectCopier.for(input.context, output.context);
    const layers = new OptionalContentSource(input, output, copier);
    expect(() => layers.finish()).toThrow("レイヤー設定が複雑すぎる");

    const many = await PDFDocument.create();
    const singleGroup = many.context.register(many.context.obj({ Type: "OCG", Name: PDFString.of("one") }));
    many.catalog.set(N("OCProperties"), many.context.register(many.context.obj({ OCGs: Array(10_001).fill(singleGroup) })));
    const manyOutput = await PDFDocument.create();
    const manyCopier = PDFObjectCopier.for(many.context, manyOutput.context);
    expect(() => new OptionalContentSource(many, manyOutput, manyCopier)).toThrow("レイヤー数が保存上限");
  });

  it("omits optional-content metadata when the source has no OCG catalog", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const model = await importPdf({ name: "plain.pdf", bytes: await pdf.save() });
    const output = await PDFDocument.load(await exportPdf(model));
    expect(output.catalog.has(N("OCProperties"))).toBe(false);
    releasePdfs();
  });
});


it("renames layer groups without changing visibility, membership or immutable source bytes", async () => {
  const source = await layeredPdf(), model = await importPdf({ name: "layers.pdf", bytes: source.bytes });
  const id = Object.keys(model.sources)[0], info = await readLayers(model.sources[id]);
  const ids = info.groups.map(g => g.id), history = new History(model);
  history.execute(renameLayer(id, ids[0], "図の日本語レイヤー", ids));
  history.execute(renameLayer(id, ids[1], "Locked renamed", ids));
  const restored = await openProject(await saveProject(history.current.document));
  expect(restored.sources[id].layerNames?.[ids[0]]).toBe("図の日本語レイヤー");
  const saved = await PDFDocument.load(await exportPdf(restored));
  const groups = saved.catalog.lookup(N("OCProperties"), PDFDict).lookup(N("OCGs"), PDFArray);
  expect((groups.lookup(0, PDFDict).lookup(N("Name")) as PDFString).decodeText()).toBe("図の日本語レイヤー");
  expect(model.sources[id].bytes).toEqual(source.bytes);
  history.undo(); expect(history.current.document.sources[id].layerNames?.[ids[1]]).toBeUndefined();
  const reset = resetLayerNames(id).apply(restored); expect(reset.sources[id].layerNames).toBeUndefined();
  expect(() => renameLayer(id, "999R", "Unknown", ids)).toThrow();
  expect(() => renameLayer(id, ids[0], " ", ids)).toThrow();
  await releasePdfs();
});
