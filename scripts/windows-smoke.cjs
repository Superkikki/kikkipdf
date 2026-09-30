/* Controlled local WebView2 integration test. Debugging port exists only for this process. */
const { chromium, expect } = require("@playwright/test");
const {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFHexString,
} = require("pdf-lib");
const fs = require("node:fs/promises");
const path = require("node:path");
(async () => {
  const started = Date.now();
  let browser;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!browser) throw Error("WebView2 debugging endpoint did not start");
  const context = browser.contexts()[0];
  let page = context.pages()[0];
  if (!page) page = await context.waitForEvent("page");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await expect(page.locator(".document-tab")).toContainText(
    "native-fixture.pdf",
    { timeout: 30000 },
  );
  await expect(
    page.locator(".viewer-scroll .page-view[data-rendered=true]").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "ページ管理", exact: true }).click();
  await page.getByRole("button", { name: "回転", exact: true }).click();
  await page
    .locator(".viewer-scroll .textLayer span")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
  await page
    .getByRole("toolbar", { name: "選択文字への注釈" })
    .getByRole("button", { name: "蛍光ペン", exact: true })
    .click();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  const box = await page
    .locator(".viewer-scroll .page-view")
    .first()
    .boundingBox();
  await page.mouse.click(box.x + 80, box.y + 130);
  await page
    .getByLabel("テキスト内容")
    .fill("Windows native save wraps across multiple lines");
  await page.getByLabel("width", { exact: true }).fill("120");
  await page.getByLabel("x", { exact: true }).fill("60");
  await page.getByLabel("y", { exact: true }).fill("140");
  await page.getByLabel("行間", { exact: true }).fill("1.6");
  await expect
    .poll(() =>
      page
        .locator(".viewer-scroll .editable-text[data-layout-ready=true] tspan")
        .count(),
    )
    .toBeGreaterThan(1);
  await page
    .getByRole("button", { name: "文字に合わせて高さを調整", exact: true })
    .click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator(".status-message")).toContainText("保存しました", {
    timeout: 30000,
  });
  const root = path.resolve(__dirname, "..");
  await fs.mkdir(path.join(root, ".tools"), { recursive: true });
  const fixture = path.join(process.env.KIKKI_SMOKE_DIR, "native-fixture.pdf");
  const pdf = await PDFDocument.load(await fs.readFile(fixture));
  if (pdf.getPage(0).getRotation().angle !== 90)
    throw Error("Native rotation did not persist");
  const markup = pdf.getPage(0).node.Annots();
  if (
    !Array.from({ length: markup.size() }, (_, i) =>
      markup.lookup(i, PDFDict),
    ).some(
      (annotation) =>
        annotation.get(PDFName.of("Subtype")) === PDFName.of("Highlight"),
    )
  )
    throw Error("Native selected-text markup did not persist");
  await page.screenshot({
    path: path.join(root, ".tools", "windows-native.png"),
  });
  const denied = await page.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke("read_document", {
        path: "C:\\Windows\\win.ini",
      });
      return false;
    } catch {
      return true;
    }
  });
  if (!denied) throw Error("Unselected file read was allowed");
  const overflows = await page
    .locator(".property-content")
    .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  if (overflows) throw Error("Property controls overflow horizontally");
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("NativeOriginal", { exact: true })
    .fill("日本語の既存欄");
  await page
    .getByRole("button", { name: "フォームを作成・編集", exact: true })
    .click();
  await page
    .getByLabel("既存の入力欄", { exact: true })
    .selectOption({ label: "NativeOriginal — ページ1" });
  await page.getByLabel("既存フィールドx", { exact: true }).fill("250");
  await page.getByLabel("既存フィールドy", { exact: true }).fill("220");
  await page.getByLabel("既存フィールドwidth", { exact: true }).fill("120");
  await page.getByLabel("既存フィールドheight", { exact: true }).fill("40");
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator(".busy-overlay")).toHaveCount(0, {
    timeout: 30000,
  });
  const imported = (await PDFDocument.load(await fs.readFile(fixture)))
    .getForm()
    .getTextField("NativeOriginal");
  if (imported.getText() !== "日本語の既存欄")
    throw Error("Imported form value did not persist");
  const rectangle = imported.acroField.getWidgets()[0].getRectangle();
  if (
    rectangle.x !== 250 ||
    rectangle.y !== 335 ||
    rectangle.width !== 120 ||
    rectangle.height !== 40
  )
    throw Error("Imported form placement did not persist");
  await page.getByRole("button", { name: "OCR", exact: true }).click();
  await page.getByLabel("ページ範囲（空欄は全ページ）").fill("1");
  await page.getByLabel("言語", { exact: true }).selectOption("jpn+eng");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "適用", exact: true })
    .click();
  await expect(page.locator(".status-message")).toContainText("OCR完了", {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator(".status-message")).toContainText("保存しました", {
    timeout: 30000,
  });
  const decrypted = await page.evaluate(
    async (input) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      // Synthetic test credential, never used with a user document.
      const password = "Kikki-Smoke-Only-123";
      const encrypted = await invoke("encrypt_pdf", { bytes: input, password });
      const output = await invoke("decrypt_pdf", {
        bytes: Array.from(new Uint8Array(encrypted)),
        password,
      });
      return Array.from(new Uint8Array(output));
    },
    Array.from(await fs.readFile(fixture)),
  );
  const roundTrip = await PDFDocument.load(new Uint8Array(decrypted));
  if (roundTrip.getPageCount() !== 3)
    throw Error("Native encryption round trip failed");
  await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  await page
    .getByRole("button", { name: "フォームを作成・編集", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "テキスト", exact: true })
    .click();
  await page.getByLabel("フィールド名", { exact: true }).fill("NativeName");
  await page.getByRole("button", { name: "値を入力", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("NativeName", { exact: true })
    .fill("日本語フォーム");
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await page.getByRole("button", { name: "しおり", exact: true }).click();
  await page
    .getByRole("button", { name: "現在のページにしおり", exact: true })
    .click();
  await page
    .getByLabel("しおりの名前", { exact: true })
    .fill("Windows bookmark");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator(".status-message")).toContainText("保存しました", {
    timeout: 30000,
  });
  const advanced = await PDFDocument.load(await fs.readFile(fixture));
  if (
    advanced.getForm().getTextField("NativeName").getText() !== "日本語フォーム"
  )
    throw Error("Native editable form did not persist");
  if (!advanced.catalog.has(PDFName.of("Outlines")))
    throw Error("Native bookmarks did not persist");
  await page.getByRole("button", { name: "添付ファイル", exact: true }).click();
  await page
    .locator(".attachment-item")
    .filter({ hasText: "native-note.txt" })
    .click();
  await page
    .getByLabel("添付ファイル名", { exact: true })
    .fill("native-renamed.txt");
  await page
    .getByLabel("添付の説明", { exact: true })
    .fill("Windows attachment");
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("button", { name: "リンク", exact: true }).click();
  const linkBox = await page
    .locator(".viewer-scroll .page-view")
    .first()
    .boundingBox();
  await page.mouse.click(linkBox.x + 140, linkBox.y + 220);
  await page
    .getByLabel("リンク先ページ", { exact: true })
    .selectOption({ label: "2 ページ" });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator(".busy-overlay")).toHaveCount(0, {
    timeout: 30000,
  });
  const withFiles = await PDFDocument.load(await fs.readFile(fixture));
  const attached = withFiles.catalog
    .lookup(PDFName.of("Names"), PDFDict)
    .lookup(PDFName.of("EmbeddedFiles"), PDFDict)
    .lookup(PDFName.of("Names"), PDFArray);
  if (attached.lookup(0, PDFHexString).decodeText() !== "native-renamed.txt")
    throw Error("Native attachment rename did not persist");
  const annots = withFiles.getPage(0).node.Annots();
  const link = Array.from({ length: annots.size() }, (_, i) =>
    annots.lookup(i, PDFDict),
  ).find((a) => a.get(PDFName.of("Subtype")) === PDFName.of("Link"));
  if (
    !link ||
    link.lookup(PDFName.of("Dest"), PDFArray).get(0) !==
      withFiles.getPage(1).ref
  )
    throw Error("Native internal link did not persist");
  await page.getByRole("button", { name: "OCR校正", exact: true }).click();
  await page.locator(".ocr-row").first().click();
  await page.getByLabel("テキスト内容").fill("Windows OCR corrected");
  await page
    .getByRole("button", { name: "確認済みにする", exact: true })
    .click();
  await expect(page.locator(".ocr-summary")).toContainText("1 /");
  await page.getByRole("button", { name: "ページ管理", exact: true }).click();
  await page.getByRole("button", { name: "一括操作", exact: true }).click();
  await page.getByLabel("ページ範囲（空欄は全ページ）").fill("2-3");
  await page.getByLabel("操作", { exact: true }).selectOption("左に90°回転");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "適用", exact: true })
    .click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
  const reviewed = await PDFDocument.load(await fs.readFile(fixture));
  if (
    reviewed.getPage(1).getRotation().angle !== 270 ||
    reviewed.getPage(2).getRotation().angle !== 270
  )
    throw Error("Native batch rotation did not persist");
  await page.screenshot({
    path: path.join(root, ".tools", "windows-native-advanced.png"),
  });
  console.log(
    JSON.stringify({
      native: true,
      title: await page.title(),
      pageCount: pdf.getPageCount(),
      rotation: pdf.getPage(0).getRotation().angle,
      unselectedPathDenied: denied,
      ocrJapaneseAndEnglish: true,
      nativeEncryptionRoundTrip: true,
      editableJapaneseForm: true,
      savedBookmarks: true,
      savedAttachments: true,
      savedInternalLink: true,
      ocrProofread: true,
      batchPageRotation: true,
      textBoxWrap: true,
      selectedTextMarkup: true,
      importedFormLayout: true,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      errors,
    }),
  );
  if (errors.length) throw Error(errors.join("\n"));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
