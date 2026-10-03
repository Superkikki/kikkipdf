import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

test("repeated saves reuse Worker input bytes and the Japanese font", async ({ page }) => {
  let fontRequests = 0;
  page.on("request", request => {
    if (request.url().endsWith("/assets/NotoSansJP-Regular.otf")) fontRequests++;
  });
  await page.addInitScript(() => {
    type TransferLog = { type: string; byteLength: number }[];
    const state = window as unknown as { pdfTransfers: TransferLog };
    state.pdfTransfers = [];
    const post = Worker.prototype.postMessage as (this: Worker, message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => void;
    Worker.prototype.postMessage = function(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
      const value = message as { request?: { type: string }; binaries?: Record<string, Uint8Array> };
      if (value.request && value.binaries) state.pdfTransfers.push({
        type: value.request.type,
        byteLength: Object.values(value.binaries).reduce((n, bytes) => n + bytes.byteLength, 0),
      });
      return post.call(this, message, transfer);
    };
  });
  const pdf = await PDFDocument.create(); pdf.addPage();
  const source = Buffer.from(await pdf.save());
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "cache.pdf", mimeType: "application/pdf", buffer: source });
  await expect(page.locator(".document-tab")).toContainText("cache.pdf");
  let fontRequestsAfterFirstSave = 0;
  for (let i = 0; i < 2; i++) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await download;
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
    if (i === 0) fontRequestsAfterFirstSave = fontRequests;
  }
  const transfers = await page.evaluate(() => (window as unknown as { pdfTransfers: { type: string; byteLength: number }[] }).pdfTransfers);
  const exports = transfers.filter(entry => entry.type === "export");
  expect(exports).toHaveLength(2);
  // Sidebar inspection may register the source before the first Save.
  expect(transfers.reduce((n, entry) => n + entry.byteLength, 0)).toBe(source.byteLength);
  expect(exports[1].byteLength).toBe(0);
  expect(fontRequestsAfterFirstSave).toBeGreaterThan(0);
  expect(fontRequests).toBe(fontRequestsAfterFirstSave);
});

test("extracting the same added attachment twice preserves cached bytes", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const clientPath = "/src/export/client.ts", modelPath = "/src/state/model.ts";
    const { readAttachment, resetExportWorker } = await import(clientPath);
    const { emptyDocument } = await import(modelPath);
    const model = emptyDocument();
    model.attachments = [{ id: "added", name: "data.bin", description: "", bytes: new Uint8Array([1, 2, 255]) }];
    try {
      const first = await readAttachment(model, "added");
      const second = await readAttachment(model, "added");
      return { first: [...first], second: [...second], original: [...model.attachments[0].bytes] };
    } finally { resetExportWorker(); }
  });
  expect(result).toEqual({ first: [1, 2, 255], second: [1, 2, 255], original: [1, 2, 255] });
});
