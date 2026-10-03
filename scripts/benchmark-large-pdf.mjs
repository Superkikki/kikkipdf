// Run against the local dev server: node scripts/benchmark-large-pdf.mjs [MiB]
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { PDFDocument } from "pdf-lib";
import { chromium } from "@playwright/test";

const mib = Number(process.argv[2] ?? 100);
if (!Number.isInteger(mib) || mib < 1 || mib > 512) throw Error("Specify 1–512 MiB.");
const directory = await mkdtemp(join(process.cwd(), "public", "large-pdf-benchmark-"));
let browser;
try {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 500]);
  // Valid, uncompressed, unreferenced stream: exercises input size independently of page count.
  pdf.context.register(pdf.context.stream(new Uint8Array(mib * 1024 * 1024)));
  const bytes = await pdf.save({ useObjectStreams: false });
  await writeFile(join(directory, "input.pdf"), bytes);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:1420");
  await page.getByRole("heading", { name: "PDFを、思いどおりに。" }).waitFor();
  const measurements = await page.evaluate(async url => {
    const clientPath = "/src/export/client.ts", modelPath = "/src/state/model.ts", recoveryPath = "/src/state/recovery.ts";
    const { exportDocument, resetExportWorker } = await import(clientPath);
    const { emptyDocument, blankPage } = await import(modelPath);
    const { saveRecovery, clearRecovery, loadRecovery } = await import(recoveryPath);
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const document = emptyDocument("benchmark.pdf");
    document.sources.source = { id: "source", name: "benchmark.pdf", bytes };
    document.pages = [{ ...blankPage(), sourceId: "source", width: 400, height: 500 }];
    const workerBytes = [], recoveryBytes = [], snapshotBytes = [];
    const post = Worker.prototype.postMessage, put = IDBObjectStore.prototype.put;
    Worker.prototype.postMessage = function(message, transfer) {
      if (message.request?.type === "export") workerBytes.push(Object.values(message.binaries).reduce((n, value) => n + value.byteLength, 0));
      return post.call(this, message, transfer);
    };
    let recoveryBinaryBytes = 0;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === "binaries") recoveryBinaryBytes += value.byteLength;
      if (this.name === "recovery") snapshotBytes.push(new TextEncoder().encode(JSON.stringify(value)).byteLength);
      return put.call(this, value, key);
    };
    try {
      await clearRecovery();
      const durations = [], outputs = [];
      for (const model of [document, { ...document, pages: [{ ...document.pages[0], rotation: 90 }] }]) {
        const start = performance.now();
        const output = await exportDocument(model);
        durations.push(Math.round(performance.now() - start));
        outputs.push([...output]);
        recoveryBinaryBytes = 0;
        await saveRecovery(model);
        recoveryBytes.push(recoveryBinaryBytes);
      }
      const restored = await loadRecovery();
      return {
        inputBytes: bytes.byteLength, workerBytes, recoveryBytes, snapshotBytes,
        exportMs: durations, outputs,
        restoredInputBytes: restored.document.sources.source.bytes.byteLength,
        restoredRotation: restored.document.pages[0].rotation,
      };
    } finally {
      Worker.prototype.postMessage = post;
      IDBObjectStore.prototype.put = put;
      resetExportWorker();
      await clearRecovery();
    }
  }, `/${basename(directory)}/input.pdf`);
  const { outputs, ...result } = measurements;
  const reloaded = await Promise.all(outputs.map(bytes => PDFDocument.load(new Uint8Array(bytes))));
  result.outputPages = reloaded.map(pdf => pdf.getPageCount());
  result.outputRotation = reloaded.map(pdf => pdf.getPage(0).getRotation().angle);
  if (result.workerBytes[1] !== 0 || result.recoveryBytes[1] !== 0 || result.restoredInputBytes !== result.inputBytes || result.restoredRotation !== 90 || result.outputPages.some(count => count !== 1) || result.outputRotation[0] !== 0 || result.outputRotation[1] !== 90)
    throw Error("Binary reuse or recovery round trip failed.");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
