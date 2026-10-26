import { expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRawStream, PDFString, degrees } from "pdf-lib";
import { processPdf } from "../src/optimization/engine";
import { processBatch } from "../src/optimization/batch";
import { zipSync, unzipSync } from "fflate";
const settings = { compression: "lossless" as const, rotation: 0, clearMetadata: false };
async function fixture() {
  const doc = await PDFDocument.create(); const page = doc.addPage([300, 400]); doc.setTitle("Private title"); doc.setAuthor("Alice");
  const text = doc.getForm().createTextField("Name"); text.addToPage(page, { x: 30, y: 50, width: 100, height: 20 }); text.setText("Original");
  const content = doc.context.stream(new TextEncoder().encode("% repeated comment for compression\n".repeat(1000)));
  page.node.set(PDFName.of("Contents"), doc.context.register(content));
  await doc.attach(new Uint8Array([1, 2, 3]), "data.bin");
  return doc.save({ useObjectStreams: false });
}
it("reduces uncompressed streams, preserves editable forms, page dimensions and attachments", async () => {
  const input = await fixture(), result = await processPdf(input, settings), doc = await PDFDocument.load(result.bytes);
  expect(result.after).toBeLessThan(result.before); expect(result.streams).toBeGreaterThan(0); expect(doc.getTitle()).toBe("Private title");
  expect(doc.getForm().getTextField("Name").getText()).toBe("Original"); expect(doc.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
  expect(doc.catalog.get(PDFName.of("Names"))).toBeDefined();
  expect((await PDFDocument.load(input)).getTitle()).toBe("Private title");
});
it("rotates relative to original rotation and removes Info and document XMP", async () => {
  const doc = await PDFDocument.load(await fixture()); doc.getPage(0).setRotation(degrees(270));
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(doc.context.stream(new TextEncoder().encode("<private/>"))));
  const result = await processPdf(await doc.save(), { compression: "none", rotation: 90, clearMetadata: true });
  const output = await PDFDocument.load(result.bytes, { updateMetadata: false });
  expect(output.getPage(0).getRotation().angle).toBe(0); expect(output.context.trailerInfo.Info).toBeUndefined(); expect(output.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
  expect(output.getForm().getTextField("Name").getText()).toBe("Original");
});
it("returns original bytes for a no-op and never increases compression-only size", async () => {
  const input = await fixture(); expect((await processPdf(input, { ...settings, compression: "none" })).bytes).toEqual(input);
  const first = await processPdf(input, settings), second = await processPdf(first.bytes, settings); expect(second.after).toBeLessThanOrEqual(first.after);
});
it("rejects signature dictionaries, encrypted/invalid PDFs and invalid settings", async () => {
  const doc = await PDFDocument.create(); doc.addPage(); doc.context.register(doc.context.obj({ Type: "Sig", Contents: PDFString.of("signed") }));
  await expect(processPdf(await doc.save(), settings)).rejects.toThrow("電子署名");
  await expect(processPdf(new Uint8Array(), settings)).rejects.toThrow("256MB");
  await expect(processPdf(await fixture(), { ...settings, rotation: 45 })).rejects.toThrow("設定");
  await expect(processPdf(new Uint8Array([1, 2]), settings)).rejects.toThrow();
});
it("keeps unsupported image dictionaries unchanged in lossless mode", async () => {
  const doc = await PDFDocument.create(); doc.addPage();
  const ref = doc.context.register(doc.context.stream(new Uint8Array([0, 1, 2]), { Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceRGB", BitsPerComponent: 8 }));
  const result = await processPdf(await doc.save(), settings); const output = await PDFDocument.load(result.bytes);
  expect((output.context.lookup(ref) as PDFRawStream).contents).toEqual(new Uint8Array([0, 1, 2])); expect(result.images).toBe(0); expect(result.skippedImages).toBe(1);
});
it("batch keeps successes, reports failures and gives duplicate/path-like filenames safe unique names", async () => {
  const bytes = await fixture(), files = [{ name: "../Same.pdf", bytes }, { name: "../Same.pdf", bytes }, { name: "bad.pdf", bytes: new Uint8Array([1]) }], rows: unknown[] = [];
  const result = await processBatch(files, settings, processPdf, new AbortController().signal, row => rows.push(row));
  expect(rows).toHaveLength(3); expect(result.rows[2].error).toBeTruthy(); expect(Object.keys(result.files)).toEqual(["Same-processed.pdf", "Same-processed (2).pdf", "report.json"]);
  const archive = unzipSync(zipSync(result.files)); expect(JSON.parse(new TextDecoder().decode(archive["report.json"])).files).toHaveLength(3);
});
it("batch rejects projects/oversized selections and aborts without returning partial files", async () => {
  const control = new AbortController(); control.abort();
  await expect(processBatch([{ name: "file.pdf", bytes: await fixture() }], settings, processPdf, control.signal, () => {})).rejects.toMatchObject({ name: "AbortError" });
  await expect(processBatch([{ name: "file.kpdf", bytes: await fixture() }], settings, processPdf, new AbortController().signal, () => {})).rejects.toThrow("PDFのみ");
  await expect(processBatch(Array.from({ length: 51 }, () => ({ name: "x.pdf", bytes: new Uint8Array() })), settings, processPdf, new AbortController().signal, () => {})).rejects.toThrow("50");
});
