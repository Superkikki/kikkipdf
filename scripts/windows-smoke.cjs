/* Controlled local WebView2 integration test. Debugging port exists only for this process. */
const { chromium, expect } = require("@playwright/test");
const {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFString,
  PDFRawStream,
  decodePDFRawStream,
} = require("pdf-lib");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
let testBrowser;
async function verifyObjectContext(page, root) {
  await page.getByRole("button", { name: "編集", exact: true }).click();
  const objects = page
    .locator(".viewer-scroll .page-view")
    .first()
    .locator(".object-layer > g");
  const countBefore = await objects.count();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const shapePage = await page
    .locator(".viewer-scroll .page-view")
    .first()
    .boundingBox();
  await page.mouse.click(shapePage.x + 190, shapePage.y + 160);
  await expect(objects).toHaveCount(countBefore + 1);
  const shape = objects.last(),
    shapeId = await shape.getAttribute("data-object-id");
  await shape.click({ button: "right" });
  const objectMenu = page.getByRole("menu", { name: "オブジェクトの操作" });
  await expect(objectMenu).toBeVisible();
  await page.screenshot({
    path: path.join(root, ".tools", "windows-native-context.png"),
  });
  await objectMenu.getByRole("menuitem", { name: "削除", exact: true }).click();
  await expect(
    page.locator(`.viewer-scroll g[data-object-id="${shapeId}"]`),
  ).toHaveCount(0);
  await expect(objects).toHaveCount(countBefore);
  await page.keyboard.press("Control+z");
  await expect(objects).toHaveCount(countBefore + 1);
  await page.keyboard.press("Control+y");
  await expect(objects).toHaveCount(countBefore);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
}
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
  testBrowser = browser;
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
  if (process.env.KIKKI_SMOKE_BOOKMARK_ONLY === "1") {
    await page.getByRole("button", { name: "しおり", exact: true }).click();
    const panel = page.locator(".bookmark-panel"), search = panel.getByLabel("しおりを検索", { exact: true });
    await expect(panel.getByRole("button", { name: "Closed chapter", exact: true })).toHaveCount(0);
    await search.fill("Needle"); await expect(panel.getByRole("button", { name: "Needle", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Needle", exact: true }).click();
    await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("2"); await expect(page.locator(".unsaved-dot")).toHaveCount(0);
    await search.fill(""); await expect(panel.getByRole("button", { name: "Closed chapter", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "すべて展開", exact: true }).click(); await expect(panel.getByRole("button", { name: "Needle", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "すべて折りたたむ", exact: true }).click(); await expect(panel.getByRole("button", { name: "Closed chapter", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^元に戻す/ }).click(); await expect(panel.getByRole("button", { name: "Needle", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^やり直す/ }).click(); await expect(panel.getByRole("button", { name: "Closed chapter", exact: true })).toHaveCount(0);
    await search.fill("Other"); await panel.getByRole("button", { name: "Other", exact: true }).click();
    const bookmarkUrl = panel.getByLabel("しおりURL", { exact: true });
    await expect(bookmarkUrl).toHaveValue("https://example.com/native");
    await expect(panel.getByLabel("しおりの文字色", { exact: true })).toHaveValue("#336699");
    await expect(panel.getByRole("checkbox", { name: "しおりの太字", exact: true })).toBeChecked();
    await expect(panel.getByRole("checkbox", { name: "しおりの斜体", exact: true })).toBeChecked();
    await panel.getByRole("button", { name: "書式を標準に戻す", exact: true }).click();
    await expect(panel.getByLabel("しおりの文字色", { exact: true })).toHaveValue("#000000");
    await page.getByRole("button", { name: /^元に戻す/ }).click();
    await expect(panel.getByLabel("しおりの文字色", { exact: true })).toHaveValue("#336699");
    await panel.getByLabel("しおりの文字色", { exact: true }).fill("#993366");
    await panel.getByRole("checkbox", { name: "しおりの斜体", exact: true }).uncheck();
    await bookmarkUrl.fill("mailto:support@example.com?subject=Native");
    await panel.getByLabel("しおりの移動先", { exact: true }).selectOption({ label: "ページ 2" });
    await expect(bookmarkUrl).toHaveCount(0);
    await page.getByRole("button", { name: /^元に戻す/ }).click();
    await expect(bookmarkUrl).toHaveValue("mailto:support@example.com?subject=Native");
    await search.fill("");
    await page.getByRole("button", { name: "保存", exact: true }).click(); await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
    const pdf = await PDFDocument.load(await fs.readFile(path.join(process.env.KIKKI_SMOKE_DIR, "native-fixture.pdf")));
    const outline = pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict), root = outline.lookup(PDFName.of("First"), PDFDict);
    if (outline.get(PDFName.of("Count")).toString() !== "1" || root.get(PDFName.of("Count")).toString() !== "-2" || root.lookup(PDFName.of("First"), PDFDict).get(PDFName.of("Count")).toString() !== "-1") throw Error("Bookmark folding or visible counts changed");
    const external = root.lookup(PDFName.of("Last"), PDFDict);
    if (external.has(PDFName.of("Dest")) || external.lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI"), PDFString).decodeText() !== "mailto:support@example.com?subject=Native") throw Error("External bookmark destination changed");
    if (external.get(PDFName.of("C")).toString() !== "[ 0.6 0.2 0.4 ]" || external.get(PDFName.of("F")).toString() !== "2") throw Error("Bookmark text formatting changed");
    if (errors.length) throw Error(JSON.stringify(errors));
    console.log(JSON.stringify({ native: true, bookmarkSearch: true, externalBookmarkUrl: true, bookmarkTextStyle: true, preservedFolding: true, bulkExpandCollapse: true, undoRedo: true, nativeSave: true, errors }));
    await browser.close(); return;
  }
  if (process.env.KIKKI_SMOKE_CHOICE_ONLY === "1") {
    const direct = page.locator(".viewer-scroll .form-page-overlay");
    await expect(direct.getByLabel("ColorCode", { exact: true })).toHaveValue(
      "G",
    );
    await expect(
      direct.getByLabel("ColorCode", { exact: true }).locator("option:checked"),
    ).toHaveText("Green");
    await direct.getByLabel("ColorCode", { exact: true }).selectOption("R");
    await page.getByRole("button", { name: "ツール", exact: true }).click();
    await page
      .getByRole("button", { name: "フォーム入力", exact: true })
      .click();
    const dialog = page.locator("dialog");
    await expect(dialog.getByLabel("ColorCode", { exact: true })).toHaveValue(
      "R",
    );
    await dialog
      .getByLabel("TagCode", { exact: true })
      .selectOption(["R", "B"]);
    await page
      .getByRole("button", { name: "フォームを作成・編集", exact: true })
      .click();
    const selector = page.getByLabel("既存の入力欄", { exact: true });
    const option = selector
      .locator("option")
      .filter({ hasText: "ColorCode — ページ1" });
    await selector.selectOption(await option.getAttribute("value"));
    await page.getByLabel("選択肢1の表示名", { exact: true }).fill("Scarlet");
    await page.getByRole("button", { name: "設定を適用", exact: true }).click();
    await page.getByRole("button", { name: "完了", exact: true }).click();
    await expect(
      direct.getByLabel("ColorCode", { exact: true }).locator("option:checked"),
    ).toHaveText("Scarlet");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".unsaved-dot")).toHaveCount(0, {
      timeout: 30000,
    });
    const pdf = await PDFDocument.load(
      await fs.readFile(
        path.join(process.env.KIKKI_SMOKE_DIR, "native-fixture.pdf"),
      ),
    );
    const dropdown = pdf.getForm().getDropdown("ColorCode"),
      list = pdf.getForm().getOptionList("TagCode");
    if (
      JSON.stringify(dropdown.getSelected()) !== '["R"]' ||
      dropdown.getOptions()[0] !== "Scarlet" ||
      dropdown.isEditable()
    )
      throw Error("Dropdown export value or label changed");
    if (
      JSON.stringify(list.getSelected()) !== '["R","B"]' ||
      list.acroField.dict.lookup(PDFName.of("I"), PDFArray).toString() !==
        "[ 0 2 ]"
    )
      throw Error("List export values or indices changed");
    const appearance = dropdown.acroField
      .getWidgets()[0]
      .dict.lookup(PDFName.of("AP"), PDFDict)
      .lookup(PDFName.of("N"), PDFRawStream);
    // Japanese-capable production font uses CID glyphs; presence of a valid appearance is checked here, text content in unit tests.
    if (!decodePDFRawStream(appearance).decode().length)
      throw Error("Missing dropdown appearance");
    await page.screenshot({
      path: path.join(process.env.KIKKI_SMOKE_DIR, "choices-saved.png"),
    });
    if (errors.length) throw Error(JSON.stringify(errors));
    console.log(
      JSON.stringify({
        ok: true,
        pairedChoices: true,
        preservedExportValues: true,
        selectionIndices: true,
        nativeSave: true,
        errors,
        elapsedMs: Date.now() - started,
      }),
    );
    await browser.close();
    return;
  }
  if (process.env.KIKKI_SMOKE_VERTICAL_ONLY === "1") {
    const original = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^日本語の縦書き$/ });
    const neighbour = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^隣の列$/ });
    const position = async () => {
      const box = await neighbour.boundingBox(), sheet = await page.locator(".viewer-scroll .page-view").first().boundingBox();
      return { x: (box.x - sheet.x) * 420 / sheet.width, y: (box.y - sheet.y) * 595 / sheet.height };
    };
    await expect(original).toBeVisible(); const before = await position();
    await page.getByRole("button", { name: "ツール", exact: true }).click();
    await page.getByRole("button", { name: "既存文字", exact: true }).click(); await original.dblclick();
    await expect(page.getByLabel("文字の方向")).toHaveValue("vertical");
    await page.getByLabel("テキスト内容").fill("変更、。「」ー");
    const overlay = page.locator(".viewer-scroll .editable-text[data-layout-ready=true]");
    await expect(overlay).toHaveText("変更、。「」ー"); await expect(overlay.locator("use")).toHaveCount(7);
    await expect(original).toHaveCount(0);
    await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]")).toBeVisible();
    const after = await position();
    if (Math.abs(after.x - before.x) > 0.2 || Math.abs(after.y - before.y) > 0.2) throw Error(`Vertical neighbour moved: ${JSON.stringify({ before, after })}`);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
    const fixture = path.join(process.env.KIKKI_SMOKE_DIR, "native-fixture.pdf");
    const saved = await PDFDocument.load(await fs.readFile(fixture));
    const fontResources = saved.getPage(0).node.Resources().lookup(PDFName.of("Font"), PDFDict);
    if (!fontResources.entries().some(([, ref]) => {
      const dict = saved.context.lookup(ref, PDFDict);
      const cmap = dict.lookup(PDFName.of("ToUnicode"));
      return dict.get(PDFName.of("Encoding")) === PDFName.of("Identity-V") && cmap instanceof PDFRawStream &&
        Buffer.from(decodePDFRawStream(cmap).decode()).toString("utf8").includes("KikkiVerticalUnicode");
    })) throw Error("Saved replacement vertical font/CMap missing");
    await page.screenshot({ path: path.join(process.env.KIKKI_SMOKE_DIR, "vertical-saved.png") });
    if (errors.length) throw Error(JSON.stringify(errors));
    console.log(JSON.stringify({ ok: true, vertical: true, errors, elapsedMs: Date.now() - started }));
    await browser.close(); return;
  }
  if (process.env.KIKKI_SMOKE_IMAGE_ONLY === "1") {
    const fixture = path.join(process.env.KIKKI_SMOKE_DIR, "native-fixture.pdf");
    const imageStreams = async () => (await PDFDocument.load(await fs.readFile(fixture))).context.enumerateIndirectObjects()
      .flatMap(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
        ? [Buffer.from(o.contents).toString("hex")] : []).sort();
    const originalPixels = await imageStreams();
    const neighbours = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^Native image neighbour$/ });
    await expect(neighbours).toHaveCount(2);
    const before = await neighbours.first().boundingBox();
    const imageTool = async () => {
      await page.getByRole("button", { name: "ツール", exact: true }).click();
      await page.getByRole("button", { name: "既存画像", exact: true }).click();
    };
    await imageTool(); await expect(page.locator(".existing-image-layer rect")).toHaveCount(2);
    await page.getByRole("button", { name: "既存画像 1", exact: true }).dblclick();
    await expect(page.locator(".properties")).toContainText("既存画像の位置とサイズ");
    const extractedPath = path.join(process.env.KIKKI_SMOKE_DIR, "extracted-image.png");
    await fs.rm(extractedPath, { force: true });
    const savePicker = promisify(execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "windows-pick-test-file.ps1"), "-TargetProcessId", process.env.KIKKI_SMOKE_PROCESS,
      "-FilePath", extractedPath], { timeout: 30000 });
    const savePicked = savePicker.then(result => ({ result }), error => ({ error }));
    await page.getByRole("button", { name: "画像を取り出す", exact: true }).click();
    const savedChoice = await savePicked; if (savedChoice.error) throw savedChoice.error;
    await expect(page.getByRole("button", { name: "画像を取り出す", exact: true })).toBeEnabled();
    const extractedPixels = await fs.readFile(extractedPath);
    if (extractedPixels.readUInt32BE(16) !== 32 || extractedPixels.readUInt32BE(20) !== 32) throw Error("Extracted image resolution changed");
    const transparent = await page.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: "image/png" }));
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data].some((v, i) => i % 4 === 3 && v === 0);
    }, extractedPixels.toString("base64"));
    if (!transparent) throw Error("Extracted image lost transparency");
    const objects = page.locator(".viewer-scroll .object-layer > g");
    await page.keyboard.press("Control+d"); await expect(objects).toHaveCount(2);
    await expect(objects.locator("image")).toHaveCount(1);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
    const copiedPdf = await PDFDocument.load(await fs.readFile(fixture));
    if (copiedPdf.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") && o.dict.lookup(PDFName.of("Width")).toString() === "32" && o.dict.get(PDFName.of("ColorSpace")) !== PDFName.of("DeviceGray")).length < 2) throw Error("Copied image missing in native save");
    await page.keyboard.press("Control+z"); await expect(objects).toHaveCount(1);
    await objects.first().click();
    for (const [field, value] of [["x", "150"], ["y", "200"], ["width", "100"], ["height", "60"]])
      await page.getByLabel(field, { exact: true }).fill(value);
    await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]")).toBeVisible();
    const after = await neighbours.first().boundingBox();
    if (Math.abs(after.x - before.x) > 0.2 || Math.abs(after.y - before.y) > 0.2) throw Error("Image neighbour moved");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
    if (JSON.stringify(await imageStreams()) !== JSON.stringify(originalPixels)) throw Error("Original image pixel data changed");
    const picker = promisify(execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "windows-pick-test-file.ps1"), "-TargetProcessId", process.env.KIKKI_SMOKE_PROCESS,
      "-FilePath", path.join(process.env.KIKKI_SMOKE_DIR, "replacement.png")], { timeout: 30000 });
    const picked = picker.then(result => ({ result }), error => ({ error }));
    await page.getByRole("button", { name: "画像を差し替える", exact: true }).click();
    const choice = await picked; if (choice.error) throw choice.error;
    await expect(page.getByRole("button", { name: "元の画像データに戻す", exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]")).toBeVisible();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
    const replacementPdf = await PDFDocument.load(await fs.readFile(fixture));
    if (!replacementPdf.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFRawStream &&
      o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") && o.dict.lookup(PDFName.of("Width")).toString() === "128")) throw Error("Replacement image missing in native save");
    await page.getByRole("button", { name: "元の画像データに戻す", exact: true }).click();
    await expect(page.getByRole("button", { name: "元の画像データに戻す", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^元に戻す/ }).click();
    await expect(page.getByRole("button", { name: "元の画像データに戻す", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "削除", exact: true }).click();
    await expect(page.locator(".properties")).toContainText("元の画像を削除");
    await page.getByRole("button", { name: /^元に戻す/ }).click();
    await expect(page.locator(".properties")).toContainText("既存画像の位置とサイズ");
    await page.getByRole("button", { name: /^やり直す/ }).click();
    await expect(page.locator(".properties")).toContainText("元の画像を削除");
    await imageTool(); await expect(page.locator(".existing-image-layer rect")).toHaveCount(1);
    await page.getByRole("button", { name: "既存画像 1", exact: true }).dblclick();
    await page.getByRole("button", { name: "削除", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
    if ((await imageStreams()).length) throw Error("Deleted image data survived native save");
    await expect(neighbours).toHaveCount(2);
    await page.screenshot({ path: path.join(__dirname, "..", ".tools", "windows-native-image.png") });
    if (errors.length) throw Error(errors.join("\n"));
    console.log(JSON.stringify({ native: true, nestedSharedImage: true, extractedTransparentImage: true, independentDuplicate: true, moveResize: true, imageReplacement: true,
      unchangedPixelsAndNeighbour: true, undoRedo: true, nativeSave: true, removedImageData: true, errors }));
    await browser.close(); return;
  }
  if (process.env.KIKKI_SMOKE_FORM_ONLY === "1") {
    const original = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^Native Form original$/ });
    const neighbours = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^Neighbour$/ });
    await expect(original).toHaveCount(2);
    const before = await neighbours.first().boundingBox();
    await page.getByRole("button", { name: "ツール", exact: true }).click();
    await page.getByRole("button", { name: "既存文字", exact: true }).click();
    await original.first().dblclick();
    await expect(page.locator(".properties")).toContainText("既存テキストを直接編集");
    await page.getByLabel("テキスト内容").fill("Native Form changed");
    await expect(original).toHaveCount(1);
    const after = await neighbours.first().boundingBox();
    if (Math.abs(after.x - before.x) > 0.2 || Math.abs(after.y - before.y) > 0.2)
      throw Error("Form neighbour moved");
    await page.getByRole("button", { name: /^元に戻す/ }).click();
    await page.getByRole("button", { name: /^元に戻す/ }).click();
    await expect(original).toHaveCount(2);
    await page.getByRole("button", { name: /^やり直す/ }).click();
    await page.getByRole("button", { name: /^やり直す/ }).click();
    await expect(original).toHaveCount(1);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
    const fixture = path.join(process.env.KIKKI_SMOKE_DIR, "native-fixture.pdf");
    const allStreams = async () => (await PDFDocument.load(await fs.readFile(fixture))).context
      .enumerateIndirectObjects().flatMap(([, o]) => o instanceof PDFRawStream
        ? [Buffer.from(decodePDFRawStream(o).decode()).toString()] : []);
    const containsOriginal = s => s.includes("Native Form original") ||
      s.toUpperCase().includes(Buffer.from("Native Form original").toString("hex").toUpperCase());
    if ((await allStreams()).filter(containsOriginal).length !== 1)
      throw Error("Unedited shared Form was lost or edited Form was not isolated");
    await page.getByRole("button", { name: "ツール", exact: true }).click();
    await page.getByRole("button", { name: "既存文字", exact: true }).click();
    await original.dblclick();
    await expect(page.getByLabel("テキスト内容")).toHaveValue("Native Form original");
    await page.getByLabel("テキスト内容").fill("Second Form changed");
    await expect(original).toHaveCount(0);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
    const streams = await allStreams();
    if (streams.some(containsOriginal)) throw Error("Original Form glyph strings survived editing both invocations");
    for (const text of ["Native Form changed", "Second Form changed"])
      if (!streams.some(s => s.toUpperCase().includes(Buffer.from(text).toString("hex").toUpperCase())))
        throw Error("Changed Form text was not saved");
    await page.screenshot({ path: path.join(__dirname, "..", ".tools", "windows-native-form.png") });
    if (errors.length) throw Error(errors.join("\n"));
    console.log(JSON.stringify({ native: true, nestedFormText: true, sharedInvocationIsolation: true,
      unchangedNeighbour: true, undoRedo: true, nativeSave: true, sourceGlyphRemoval: true, errors }));
    await browser.close(); return;
  }
  if (process.env.KIKKI_SMOKE_NAVIGATION_ONLY === "1") {
    const zoom = page.getByLabel("ズーム", { exact: true });
    await zoom.selectOption("1");
    const bounds = await page.locator(".viewer-scroll .page-view").first().boundingBox();
    await page.mouse.move(bounds.x + 160, bounds.y + 160);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(1);
    const scale = Number(await zoom.inputValue());
    await page.locator(".viewer-scroll").evaluate((el) => {
      for (let i = 0; i < 8; i++) el.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, ctrlKey: true, deltaY: -3, clientX: 500, clientY: 450,
      }));
    });
    await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(scale);
    const thumbs = page.locator(".thumbnail");
    const ids = await thumbs.evaluateAll(els => els.map(el => el.dataset.pageId));
    const a = await thumbs.nth(0).boundingBox();
    const b = await thumbs.nth(1).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.55, { steps: 12 });
    await expect(thumbs.nth(1)).toHaveClass(/drop-after/);
    await page.mouse.up();
    const order = () => thumbs.evaluateAll(els => els.map(el => el.dataset.pageId));
    await expect.poll(order).toEqual([ids[1], ids[0], ids[2]]);
    await page.keyboard.press("Control+z");
    await expect.poll(order).toEqual(ids);
    await page.keyboard.press("Control+y");
    await expect.poll(order).toEqual([ids[1], ids[0], ids[2]]);
    await thumbs.nth(2).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(order).toEqual([ids[1], ids[2], ids[0]]);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
    const saved = await PDFDocument.load(await fs.readFile(path.join(process.env.KIKKI_SMOKE_DIR, "native-fixture.pdf")));
    const contents = saved.getPage(0).node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map(ref => saved.context.lookup(ref)) : [contents];
    const expectedHex = Buffer.from("Native Windows fixture 2").toString("hex").toUpperCase();
    if (!streams.some(stream => stream instanceof PDFRawStream && Buffer.from(decodePDFRawStream(stream).decode()).toString().includes(expectedHex)))
      throw Error("Native reordered page content did not persist");
    await page.screenshot({ path: path.join(__dirname, "..", ".tools", "windows-native-navigation.png") });
    if (errors.length) throw Error(errors.join("\n"));
    console.log(JSON.stringify({ native: true, ctrlWheelZoom: true, simulatedTrackpadPinch: true, pointerPageReorder: true, keyboardPageReorder: true, undoRedo: true, reorderedPdfSave: true, errors }));
    await browser.close();
    return;
  }
  if (process.env.KIKKI_SMOKE_CONTEXT_ONLY === "1") {
    const root = path.resolve(__dirname, "..");
    await verifyObjectContext(page, root);
    const pdf = await PDFDocument.load(
      await fs.readFile(
        path.join(process.env.KIKKI_SMOKE_DIR, "native-fixture.pdf"),
      ),
    );
    const contents = pdf.getPage(0).node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => pdf.context.lookup(ref))
        : contents
          ? [contents]
          : [];
    if (
      streams.some(
        (s) =>
          s instanceof PDFRawStream &&
          /\bre\b/.test(Buffer.from(decodePDFRawStream(s).decode()).toString()),
      )
    )
      throw Error("Deleted rectangle was written to saved PDF");
    console.log(
      JSON.stringify({
        native: true,
        contextOnly: true,
        objectContextDeletion: true,
        nativeSave: true,
        pageCount: pdf.getPageCount(),
        elapsedSeconds: Math.round((Date.now() - started) / 1000),
        errors,
      }),
    );
    if (errors.length) throw Error(errors.join("\n"));
    await browser.close();
    return;
  }
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
  const picker = promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(__dirname, "windows-pick-test-file.ps1"),
      "-TargetProcessId",
      process.env.KIKKI_SMOKE_PROCESS,
      "-FilePath",
      path.join(process.env.KIKKI_SMOKE_DIR, "local-test-font.ttf"),
    ],
    { timeout: 30000 },
  );
  // Attach a rejection handler immediately while the modal dialog is opening.
  const picked = picker.then(
    (result) => ({ result }),
    (error) => ({ error }),
  );
  await page
    .getByRole("button", { name: "フォントを追加", exact: true })
    .click();
  const selection = await picked;
  if (selection.error) throw selection.error;
  await expect(page.getByLabel("フォント", { exact: true })).toHaveValue(
    /^font-/,
  );
  await expect(
    page.locator(".viewer-scroll .editable-text[data-layout-ready=true]"),
  ).toHaveAttribute("font-family", /^Kikki[a-f0-9]{64}$/);
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("フォント", { exact: true })).toHaveValue(
    "japanese",
  );
  await page.keyboard.press("Control+y");
  await expect(page.getByLabel("フォント", { exact: true })).toHaveValue(
    /^font-/,
  );
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
  const customFont = pdf.context
    .enumerateIndirectObjects()
    .find(
      ([, object]) =>
        object instanceof PDFDict && object.has(PDFName.of("FontFile2")),
    );
  if (!customFont) throw Error("Native custom font was not embedded");
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
  await page.getByRole("button", { name: "ツール", exact: true }).click();
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
  await page.getByRole("button", { name: "ページ", exact: true }).click();
  await page.locator(".thumbnail").first().click();
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  const originalText = "Native Windows fixture 1";
  const originalSpan = page
    .locator(".viewer-scroll .textLayer span")
    .filter({ hasText: new RegExp(`^${originalText}$`) });
  await originalSpan.dblclick();
  await expect(page.locator(".properties")).toContainText(
    "既存テキストを直接編集",
  );
  await page.getByLabel("テキスト内容").fill("Direct Windows edit");
  await expect(originalSpan).toHaveCount(0);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0, { timeout: 30000 });
  const directPdf = await PDFDocument.load(await fs.readFile(fixture));
  const originalHex = Buffer.from(originalText).toString("hex").toUpperCase();
  const streams = directPdf.context
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream)
    .map(([, o]) =>
      Buffer.from(decodePDFRawStream(o).decode()).toString("latin1"),
    );
  if (streams.some((s) => s.includes(originalHex)))
    throw Error("Original page glyph string survived direct editing");
  // Editing removes the selected content operation, not independently created OCR,
  // annotation comments or metadata. This test never presents it as redaction.
  const replacementHex = Buffer.from("Direct Windows edit")
    .toString("hex")
    .toUpperCase();
  if (!streams.some((s) => s.includes(replacementHex)))
    throw Error("Direct replacement was not saved");
  await verifyObjectContext(page, root);
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
      localFontPickerAndEmbedding: true,
      directSourceGlyphRemoval: true,
      objectContextDeletion: true,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      errors,
    }),
  );
  if (errors.length) throw Error(errors.join("\n"));
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  await testBrowser?.close().catch(() => {});
  process.exitCode = 1;
});
