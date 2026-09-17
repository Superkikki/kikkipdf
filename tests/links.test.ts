import { it, expect } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFString,
  PDFName,
} from "pdf-lib";
import { blankPage, emptyDocument, newObject } from "../src/state/model";
import { exportPdf } from "../src/export/engine";
import { editAnnotation } from "../src/annotations/commands";
import { validatedLinkUrl } from "../src/links/target";
import { openProject, saveProject } from "../src/state/project";
const key = PDFName.of;
it("writes internal and URL links with crop coordinates and remaps destinations on export", async () => {
  const model = emptyDocument();
  model.pages = [blankPage(), blankPage()];
  const origin = model.pages[0],
    target = model.pages[1];
  origin.crop = { x: 10, y: 25, width: 500, height: 700 };
  origin.objects = [
    { ...newObject("link", 30, 50), link: { kind: "page", pageId: target.id } },
    {
      ...newObject("link", 60, 90),
      link: { kind: "url", url: "https://example.com/日本語?q=1" },
    },
  ];
  const out = await PDFDocument.load(
    await exportPdf(model, undefined, { indices: [1, 0] }),
  );
  const annotations = out.getPage(1).node.Annots()!;
  const internal = annotations.lookup(0, PDFDict);
  expect(internal.lookup(key("Dest"), PDFArray).get(0)).toEqual(
    out.getPage(0).ref,
  );
  expect(internal.lookup(key("Rect"), PDFArray).asRectangle()).toEqual({
    x: 30,
    y: origin.height - 120,
    width: 120,
    height: 70,
  });
  const url = annotations
    .lookup(1, PDFDict)
    .lookup(key("A"), PDFDict)
    .lookup(key("URI"), PDFString)
    .decodeText();
  expect(url).toContain("https://example.com/%E6%97%A5");
  const extracted = await PDFDocument.load(
    await exportPdf(model, undefined, { indices: [0] }),
  );
  expect(extracted.getPage(0).node.Annots()!.size()).toBe(1); // Destination page excluded.
  const restored = await openProject(await saveProject(model));
  expect(restored.pages[0].objects[0].link).toEqual(origin.objects[0].link);
});
it("edits imported URL links into cross-source page destinations and deletes them", async () => {
  const input = await PDFDocument.create(),
    page = input.addPage();
  const ref = input.context.register(
    input.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [0, 0, 100, 40],
      A: { S: "URI", URI: PDFHexString.fromText("https://old.example") },
    }),
  );
  page.node.addAnnot(ref);
  let model = emptyDocument();
  model.sources.s = { id: "s", name: "source.pdf", bytes: await input.save() };
  model.pages = [
    { ...blankPage(), sourceId: "s", sourceIndex: 0 },
    blankPage(),
  ];
  model = editAnnotation(model.pages[0].id, `${ref.objectNumber}R`, {
    link: { kind: "page", pageId: model.pages[1].id },
  }).apply(model);
  let out = await PDFDocument.load(await exportPdf(model));
  const link = out.getPage(0).node.Annots()!.lookup(0, PDFDict);
  expect(link.has(key("A"))).toBe(false);
  expect(link.lookup(key("Dest"), PDFArray).get(0)).toEqual(out.getPage(1).ref);
  model = editAnnotation(model.pages[0].id, `${ref.objectNumber}R`, {
    deleted: true,
  }).apply(model);
  out = await PDFDocument.load(await exportPdf(model));
  expect(out.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
});
it("rejects executable and local-file link destinations", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///C:/Windows/win.ini",
    "data:text/html,test",
    "https://exam\nple.com",
    "mailto:",
  ])
    expect(() => validatedLinkUrl(url)).toThrow();
  expect(validatedLinkUrl(" https://example.com ")).toBe(
    "https://example.com/",
  );
  expect(validatedLinkUrl("mailto:hello@example.com")).toBe(
    "mailto:hello@example.com",
  );
});
