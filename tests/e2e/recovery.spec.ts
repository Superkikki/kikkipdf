import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { blankPage, emptyDocument } from "../../src/state/model";

async function recovery(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("kikki-pdf-local");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ time: number; document: { pages: { rotation: number }[] } } | undefined>((resolve, reject) => {
        const request = db.transaction("recovery").objectStore("recovery").get("active");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

test("clears autosaved edits on undo to clean and saves again after redo", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  const pdf = await PDFDocument.create(); pdf.addPage();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "recovery.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator(".document-tab")).toContainText("recovery.pdf");
  await page.getByRole("button", { name: "ページ管理", exact: true }).click();
  await page.getByRole("button", { name: "回転", exact: true }).click();
  await expect(page.locator(".unsaved-dot")).toBeVisible();
  await page.clock.fastForward(15000);
  await expect.poll(async () => (await recovery(page))?.document.pages[0].rotation).toBe(90);
  const time = (await recovery(page))!.time;
  await page.clock.fastForward(30000);
  expect((await recovery(page))!.time).toBe(time);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  await expect.poll(() => recovery(page)).toBeUndefined();
  await page.keyboard.press("Control+y");
  await page.clock.fastForward(15000);
  await expect.poll(async () => (await recovery(page))?.document.pages[0].rotation).toBe(90);
  await page.keyboard.press("Control+z");
  await expect.poll(() => recovery(page)).toBeUndefined();
  await page.reload();
  await expect(page.getByRole("heading", { name: "PDFを、思いどおりに。" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("preserves recovery from the previous session while the startup document is clean", async ({ page }) => {
  await page.goto("/");
  const document = emptyDocument("previous-session.pdf"); document.pages = [blankPage()];
  await page.evaluate(document => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("kikki-pdf-local");
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("recovery", "readwrite");
      tx.objectStore("recovery").put({ document, time: Date.now() }, "active");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  }), document);
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText("previous-session.pdf");
  await page.getByRole("button", { name: "復元", exact: true }).click();
  await expect(page.locator(".document-tab")).toContainText("previous-session.pdf");
  await expect(page.locator(".unsaved-dot")).toBeVisible();
});

test("orders save and clear, and writes immutable binaries only once", async ({ page }) => {
  await page.goto("/");
  const document = emptyDocument("binary-recovery.pdf"); document.pages = [blankPage()];
  const result = await page.evaluate(async document => {
    const path = "/src/state/recovery.ts";
    const { saveRecovery, clearRecovery, loadRecovery } = await import(path);
    const bytes = new Uint8Array([1, 2, 255]);
    document.sources.s = { id: "s", name: "source.pdf", bytes };
    const writes: string[] = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      writes.push(this.name);
      return put.call(this, value, key);
    };
    try {
      await saveRecovery(document);
      const restored = await loadRecovery();
      document = { ...document, pages: [{ ...document.pages[0], rotation: 90 }] };
      await saveRecovery(document);
      const restoredEdit = await loadRecovery();
      // Hydration must preserve binary IDs across restarts, too.
      await saveRecovery(restoredEdit.document);
      await Promise.all([saveRecovery(document), clearRecovery()]);
      const cleared = await loadRecovery();
      await Promise.all([clearRecovery(), saveRecovery(document)]);
      const latest = await loadRecovery();
      return {
        binaryWrites: writes.filter(name => name === "binaries").length,
        sourceBytes: [...restored.document.sources.s.bytes],
        restoredRotation: restoredEdit.document.pages[0].rotation,
        cleared: cleared === undefined,
        latestRotation: latest.document.pages[0].rotation,
      };
    } finally { IDBObjectStore.prototype.put = put; }
  }, document);
  expect(result).toEqual({ binaryWrites: 2, sourceBytes: [1, 2, 255], restoredRotation: 90, cleared: true, latestRotation: 90 });
});

test("upgrades a v1 database without losing recovery or preferences", async ({ page }) => {
  await page.route("**/recovery-migration-fixture", route => route.fulfill({ contentType: "text/html", body: "<html></html>" }));
  await page.goto("/recovery-migration-fixture");
  const document = emptyDocument("legacy.pdf"); document.pages = [blankPage()];
  await page.evaluate(document => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("kikki-pdf-local", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("recovery");
      request.result.createObjectStore("preferences");
    };
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(["recovery", "preferences"], "readwrite");
      tx.objectStore("recovery").put({ document, time: Date.now() }, "active");
      tx.objectStore("preferences").put(new Uint8Array([9, 8]), "signature");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  }), document);
  await page.clock.install();
  await page.goto("/");
  await expect(page.getByRole("dialog")).toContainText("legacy.pdf");
  await page.getByRole("button", { name: "復元", exact: true }).click();
  await page.clock.fastForward(15000);
  await expect.poll(async () => page.evaluate(async () => {
    const path = "/src/state/recovery.ts";
    const { getPreference } = await import(path);
    const signature = await getPreference("signature");
    const db = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open("kikki-pdf-local");
      request.onsuccess = () => resolve(request.result);
    });
    const version = await new Promise<number>(resolve => {
      const request = db.transaction("recovery").objectStore("recovery").get("active");
      request.onsuccess = () => resolve(request.result.version);
    });
    db.close(); return { version, signature: [...signature] };
  })).toEqual({ version: 2, signature: [9, 8] });
});

test("keeps the previous snapshot and binaries if an autosave transaction fails", async ({ page }) => {
  await page.goto("/");
  const document = emptyDocument(); document.pages = [blankPage()];
  const result = await page.evaluate(async document => {
    const path = "/src/state/recovery.ts";
    const { saveRecovery, loadRecovery } = await import(path);
    document.sources.s = { id: "s", name: "pdf", bytes: new Uint8Array([1]) };
    await saveRecovery(document);
    const next = { ...document, sources: { s: { ...document.sources.s, bytes: new Uint8Array([2]) } } };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === "recovery") throw new DOMException("Quota", "QuotaExceededError");
      return put.call(this, value, key);
    };
    let failed = false;
    try { await saveRecovery(next); } catch { failed = true; }
    finally { IDBObjectStore.prototype.put = put; }
    const old = await loadRecovery();
    await saveRecovery(next);
    const retried = await loadRecovery();
    return { failed, old: [...old.document.sources.s.bytes], retried: [...retried.document.sources.s.bytes] };
  }, document);
  expect(result).toEqual({ failed: true, old: [1], retried: [2] });
});
