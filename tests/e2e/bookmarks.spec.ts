import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFDict, PDFName, PDFHexString, PDFString, PDFArray, PDFNumber, degrees } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { emptyDocument, blankPage } from "../../src/state/model";
import { exportPdf } from "../../src/export/engine";
import { openProject } from "../../src/state/project";

async function fixture() {
  const model = emptyDocument();
  model.pages = [blankPage(), blankPage()];
  model.bookmarks = [
    {
      id: "root",
      title: "Root",
      expanded: false,
      children: [
        {
          id: "closed",
          title: "Closed chapter",
          expanded: false,
          children: [
            {
              id: "needle",
              title: "Needle 資料",
              pageId: model.pages[1].id,
              children: [],
            },
          ],
        },
        {
          id: "other",
          title: "Other",
          pageId: model.pages[0].id,
          children: [],
        },
      ],
    },
  ];
  return Buffer.from(await exportPdf(model));
}
async function open(page: Page, buffer: Buffer, name = "bookmarks.pdf") {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer });
  await page.getByRole("button", { name: "しおり", exact: true }).click();
}

async function locationFixture(rotated = false, cropped = false) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 4; i++) pdf.addPage([600, 1000]);
  const target = pdf.getPage(1);
  if (rotated || cropped) {
    target.setMediaBox(0, 0, 700, 1200);
    target.setCropBox(50, 100, 600, 1000);
    if (rotated) target.setRotation(degrees(90));
  }
  const context = pdf.context;
  const root = context.obj({ Type: "Outlines", Count: 2 });
  const rootRef = context.register(root);
  const first = context.obj({
    Title: PDFHexString.fromText("位置と倍率"), Parent: rootRef,
    Dest: [target.ref, "XYZ", rotated ? 250 : 0, rotated ? 400 : 600, rotated ? 2.5 : 1.5],
  });
  const second = context.obj({
    Title: PDFHexString.fromText("幅と位置"), Parent: rootRef,
    Dest: [target.ref, "FitH", 750],
  });
  const firstRef = context.register(first), secondRef = context.register(second);
  first.set(PDFName.of("Next"), secondRef);
  second.set(PDFName.of("Prev"), firstRef);
  root.set(PDFName.of("First"), firstRef);
  root.set(PDFName.of("Last"), secondRef);
  pdf.catalog.set(PDFName.of("Outlines"), rootRef);
  return Buffer.from(await pdf.save());
}

async function visiblePagePoint(page: Page, index = 1, width = 600) {
  return page.locator(".viewer-scroll .page-view").nth(index).evaluate((el, pageWidth) => {
    const viewer = el.closest<HTMLElement>(".viewer-scroll")!;
    const bounds = el.getBoundingClientRect(), root = viewer.getBoundingClientRect();
    const scale = bounds.width / pageWidth;
    return {
      x: (root.left + viewer.clientLeft - bounds.left) / scale,
      y: (root.top + viewer.clientTop - bounds.top) / scale,
      scale,
    };
  }, width);
}

test("searches collapsed bookmarks without changing saved folding and preserves expand/collapse with undo, project and PDF", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await open(page, await fixture());
  const panel = page.locator(".bookmark-panel"),
    search = panel.getByLabel("しおりを検索", { exact: true });
  await expect(
    panel.getByRole("button", { name: "Root", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Closed chapter", exact: true }),
  ).toHaveCount(0);
  await search.fill("ＮＥＥＤＬＥ");
  await expect(
    panel.getByRole("button", { name: "Needle 資料", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Other", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "すべて折りたたむ", exact: true }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Needle 資料", exact: true }).click();
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("2");
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  await search.fill("missing");
  await expect(panel).toContainText("一致するしおりはありません。");
  await search.fill("");
  await expect(
    panel.getByRole("button", { name: "Closed chapter", exact: true }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "展開：Root", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Closed chapter", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Needle 資料", exact: true }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "すべて展開", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Needle 資料", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await expect(
    panel.getByRole("button", { name: "Needle 資料", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^やり直す/ }).click();
  await panel
    .getByRole("button", { name: "すべて折りたたむ", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Closed chapter", exact: true }),
  ).toHaveCount(0);
  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page
    .getByRole("button", { name: "編集プロジェクトを保存", exact: true })
    .click();
  const project = info.outputPath("collapsed.kpdf");
  await (await download).saveAs(project);
  const restored = await openProject(new Uint8Array(await readFile(project)));
  expect(restored.bookmarks![0].expanded).toBe(false);
  expect(restored.bookmarks![0].children[0].expanded).toBe(false);
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("collapsed.pdf");
  await (await download).saveAs(saved);
  const pdf = await PDFDocument.load(await readFile(saved)),
    outline = pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict),
    root = outline.lookup(PDFName.of("First"), PDFDict);
  expect(outline.get(PDFName.of("Count"))?.toString()).toBe("1");
  expect(root.get(PDFName.of("Count"))?.toString()).toBe("-2");
  await page.reload();
  await open(page, await readFile(saved));
  await expect(
    panel.getByRole("button", { name: "Closed chapter", exact: true }),
  ).toHaveCount(0);
  await search.fill("資料");
  await expect(
    panel.getByRole("button", { name: "Needle 資料", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("preserves and edits external bookmark URLs, switches to pages with undo and saves URI actions without navigation", async ({ page }, info) => {
  const input = await PDFDocument.create();
  input.addPage(); input.addPage();
  const context = input.context, outline = context.obj({ Type: "Outlines", Count: 3 });
  const outlineRef = context.register(outline);
  const nodes = [
    context.obj({ Title: PDFHexString.fromText("Web 資料"), A: { S: "URI", URI: PDFHexString.fromText("https://example.com/日本語?q=1") } }),
    context.obj({ Title: PDFHexString.fromText("メール"), A: { S: "URI", URI: PDFString.of("mailto:hello@example.com") } }),
    context.obj({ Title: PDFHexString.fromText("危険"), A: { S: "URI", URI: PDFString.of("javascript:alert(1)") } }),
  ];
  const refs = nodes.map((node) => context.register(node));
  nodes.forEach((node, i) => {
    node.set(PDFName.of("Parent"), outlineRef);
    if (i) node.set(PDFName.of("Prev"), refs[i - 1]);
    if (i + 1 < refs.length) node.set(PDFName.of("Next"), refs[i + 1]);
  });
  outline.set(PDFName.of("First"), refs[0]); outline.set(PDFName.of("Last"), refs.at(-1)!);
  input.catalog.set(PDFName.of("Outlines"), outlineRef);
  const errors: string[] = [], externalRequests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (r.url().includes("example.com")) externalRequests.push(r.url()); });
  await page.goto("/");
  await open(page, Buffer.from(await input.save()), "external-bookmarks.pdf");
  const panel = page.locator(".bookmark-panel"), target = panel.getByLabel("しおりの移動先", { exact: true }), url = panel.getByLabel("しおりURL", { exact: true });
  await panel.getByRole("button", { name: "Web 資料", exact: true }).click();
  await expect(url).toHaveValue("https://example.com/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=1");
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  await panel.getByRole("button", { name: "危険", exact: true }).click();
  await expect(target).toHaveValue(""); await expect(url).toHaveCount(0);
  await panel.getByRole("button", { name: "メール", exact: true }).click();
  await expect(url).toHaveValue("mailto:hello@example.com");
  await target.selectOption({ label: "ページ 2" });
  await expect(url).toHaveCount(0);
  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await expect(url).toHaveValue("mailto:hello@example.com");
  await page.getByRole("button", { name: /^やり直す/ }).click();
  await expect(url).toHaveCount(0);
  await target.selectOption("url");
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await url.fill("file:///C:/private.txt");
  await expect(panel.getByRole("alert")).toBeVisible();
  await url.fill("mailto:support@example.com?subject=PDF");
  await expect(url).toHaveAttribute("aria-invalid", "false");
  await panel.getByRole("button", { name: "Web 資料", exact: true }).click();
  await url.fill("https://example.com/更新?q=2");
  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const projectPath = info.outputPath("external.kpdf"); await (await download).saveAs(projectPath);
  const project = await openProject(new Uint8Array(await readFile(projectPath)));
  expect(project.bookmarks![0].url).toBe("https://example.com/更新?q=2");
  expect(project.bookmarks![1].url).toBe("mailto:support@example.com?subject=PDF");
  expect(project.bookmarks![1].pageId).toBeUndefined();
  download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("external.pdf"); await (await download).saveAs(saved);
  const pdf = await PDFDocument.load(await readFile(saved));
  const first = pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict).lookup(PDFName.of("First"), PDFDict);
  expect(first.has(PDFName.of("Dest"))).toBe(false);
  expect(first.lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI"), PDFString).decodeText()).toBe("https://example.com/%E6%9B%B4%E6%96%B0?q=2");
  const second = first.lookup(PDFName.of("Next"), PDFDict);
  expect(second.lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI"), PDFString).decodeText()).toBe("mailto:support@example.com?subject=PDF");
  expect(second.lookup(PDFName.of("Next"), PDFDict).has(PDFName.of("A"))).toBe(false);
  await page.reload(); await open(page, await readFile(saved));
  await panel.getByRole("button", { name: "Web 資料", exact: true }).click();
  await expect(url).toHaveValue("https://example.com/%E6%9B%B4%E6%96%B0?q=2");
  await panel.getByRole("button", { name: "メール", exact: true }).click();
  await expect(url).toHaveValue("mailto:support@example.com?subject=PDF");
  expect(externalRequests).toEqual([]); expect(errors).toEqual([]);
});

test("preserves bookmark text color, bold and italic across editing, undo, project and PDF saves", async ({ page }, info) => {
  const model = emptyDocument(); model.pages = [blankPage()];
  model.bookmarks = [{ id: "styled", title: "書式つき", color: "#336699", bold: true, italic: true, children: [] }];
  await page.goto("/"); await open(page, Buffer.from(await exportPdf(model)), "styled-bookmarks.pdf");
  const panel = page.locator(".bookmark-panel"), item = panel.getByRole("button", { name: "書式つき", exact: true });
  const text = item.locator("span"), color = panel.getByLabel("しおりの文字色", { exact: true }), bold = panel.getByRole("checkbox", { name: "しおりの太字", exact: true }), italic = panel.getByRole("checkbox", { name: "しおりの斜体", exact: true });
  await item.click();
  await expect(color).toHaveValue("#336699"); await expect(bold).toBeChecked(); await expect(italic).toBeChecked();
  await expect(text).toHaveCSS("color", "rgb(51, 102, 153)"); await expect(text).toHaveCSS("font-weight", "700"); await expect(text).toHaveCSS("font-style", "italic");
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  await panel.getByRole("button", { name: "書式を標準に戻す", exact: true }).click();
  await expect(color).toHaveValue("#000000"); await expect(bold).not.toBeChecked(); await expect(italic).not.toBeChecked();
  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await expect(color).toHaveValue("#336699"); await expect(bold).toBeChecked(); await expect(italic).toBeChecked();
  await color.fill("#993366"); await italic.uncheck();
  await expect(text).toHaveCSS("color", "rgb(153, 51, 102)"); await expect(text).toHaveCSS("font-style", "normal");
  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const projectPath = info.outputPath("styled.kpdf"); await (await download).saveAs(projectPath);
  const restored = await openProject(new Uint8Array(await readFile(projectPath)));
  expect(restored.bookmarks![0]).toMatchObject({ color: "#993366", bold: true, italic: false });
  download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("styled.pdf"); await (await download).saveAs(saved);
  const pdf = await PDFDocument.load(await readFile(saved));
  const node = pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict).lookup(PDFName.of("First"), PDFDict);
  expect(node.get(PDFName.of("C"))?.toString()).toBe("[ 0.6 0.2 0.4 ]");
  expect(node.get(PDFName.of("F"))?.toString()).toBe("2");
  await page.reload(); await open(page, await readFile(saved)); await item.click();
  await expect(color).toHaveValue("#993366"); await expect(bold).toBeChecked(); await expect(italic).not.toBeChecked();
});

test("bookmark clicks restore XYZ and FitH positions, including repeated navigation on the same page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/"); await open(page, await locationFixture());
  const panel = page.locator(".bookmark-panel"), zoom = page.getByLabel("ズーム", { exact: true });
  const point = panel.getByRole("button", { name: "位置と倍率", exact: true });
  await point.click();
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("2");
  await expect(zoom).toHaveValue("1.5");
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(400, 0);
  await expect(panel.getByLabel("しおりの上位置", { exact: true })).toHaveValue("600");
  await expect(panel.getByLabel("しおりの倍率（%）", { exact: true })).toHaveValue("150");
  await panel.getByRole("button", { name: "幅と位置", exact: true }).click();
  await expect(zoom).toHaveValue("width");
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(250, 0);
  await point.click();
  await expect(zoom).toHaveValue("1.5");
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(400, 0);
  await page.locator(".viewer-scroll").evaluate((el) => { el.scrollTop += 140; });
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeGreaterThan(480);
  await point.click();
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(400, 0);
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("captures and edits bookmark view positions with undo and project/PDF round trips", async ({ page }, info) => {
  await page.goto("/"); await open(page, await locationFixture());
  const panel = page.locator(".bookmark-panel"), zoom = page.getByLabel("ズーム", { exact: true });
  const mode = panel.getByLabel("しおりの表示方法", { exact: true });
  const top = panel.getByLabel("しおりの上位置", { exact: true });
  const scale = panel.getByLabel("しおりの倍率（%）", { exact: true });
  await panel.getByRole("button", { name: "位置と倍率", exact: true }).click();
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(400, 0);
  await top.fill("500"); await scale.fill("200");
  await panel.getByRole("button", { name: "位置と倍率", exact: true }).click();
  await expect(zoom).toHaveValue("2");
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(500, 0);
  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await expect(scale).toHaveValue("150");
  await page.getByRole("button", { name: /^やり直す/ }).click();
  await expect(scale).toHaveValue("200");
  await zoom.selectOption("1.5");
  const paper = page.locator(".viewer-scroll .page-view").nth(1);
  await paper.evaluate((el) => {
    const viewer = el.closest<HTMLElement>(".viewer-scroll")!;
    viewer.scrollTop += el.getBoundingClientRect().top - viewer.getBoundingClientRect().top + 480;
  });
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(320, 0);
  await panel.getByRole("button", { name: "表示位置にしおり", exact: true }).click();
  await expect(mode).toHaveValue("XYZ");
  await expect.poll(async () => Number(await top.inputValue())).toBeCloseTo(680, 0);
  await expect(scale).toHaveValue("150");
  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await expect(panel.getByRole("button", { name: "ページ 2", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^やり直す/ }).click();
  await expect(panel.getByRole("button", { name: "ページ 2", exact: true })).toBeVisible();
  await expect.poll(async () => Number(await top.inputValue())).toBeCloseTo(680, 0);
  await panel.getByLabel("しおりの名前", { exact: true }).fill("保存した表示位置");
  await page.locator(".viewer-scroll").evaluate((el) => { el.scrollTop += 120; });
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(400, 0);
  await panel.getByRole("button", { name: "現在の表示位置を移動先に設定", exact: true }).click();
  await expect.poll(async () => Number(await top.inputValue())).toBeCloseTo(600, 0);
  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await expect.poll(async () => Number(await top.inputValue())).toBeCloseTo(680, 0);
  await page.getByRole("button", { name: /^やり直す/ }).click();
  await expect.poll(async () => Number(await top.inputValue())).toBeCloseTo(600, 0);
  await panel.getByRole("button", { name: "幅と位置", exact: true }).click();
  await mode.selectOption("XYZ");
  await top.fill(""); await scale.fill("");
  await expect(top).toHaveValue(""); await expect(scale).toHaveValue("");
  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const projectPath = info.outputPath("bookmark-locations.kpdf");
  await (await download).saveAs(projectPath);
  const restored = await openProject(new Uint8Array(await readFile(projectPath)));
  const captured = restored.bookmarks!.find((b) => b.title === "保存した表示位置")!;
  expect(captured.pageId).toBe(restored.pages[1].id);
  expect(captured.destination).toMatchObject({ kind: "XYZ", left: 0, zoom: 1.5 });
  expect(captured.destination!.kind === "XYZ" && captured.destination!.top).toBeCloseTo(600, 0);
  expect(restored.bookmarks![1].destination).toEqual({ kind: "XYZ", left: null, top: null, zoom: null });
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("bookmark-locations.pdf"); await (await download).saveAs(saved);
  const pdf = await PDFDocument.load(await readFile(saved));
  const first = pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict).lookup(PDFName.of("First"), PDFDict);
  const nullable = first.lookup(PDFName.of("Next"), PDFDict);
  expect(nullable.lookup(PDFName.of("Dest"), PDFArray).toString()).toContain("/XYZ null null null");
  const dest = nullable.lookup(PDFName.of("Next"), PDFDict).lookup(PDFName.of("Dest"), PDFArray);
  expect(dest.get(0).toString()).toBe(pdf.getPage(1).ref.toString());
  expect(dest.get(1).toString()).toBe("/XYZ");
  expect(dest.lookup(3, PDFNumber).asNumber()).toBeCloseTo(600, 0);
  expect(dest.lookup(4, PDFNumber).asNumber()).toBeCloseTo(1.5, 4);
  await page.reload(); await open(page, await readFile(saved));
  await page.getByLabel("ページ番号", { exact: true }).fill("4");
  await zoom.selectOption("1");
  await panel.getByRole("button", { name: "保存した表示位置", exact: true }).click();
  await expect(zoom).toHaveValue("1.5");
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(400, 0);
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("2");
  await expect(zoom).toHaveValue("1.5");
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(400, 0);
  await page.reload(); await open(page, await readFile(projectPath), "bookmark-locations.kpdf");
  await page.getByLabel("ページ番号", { exact: true }).fill("4");
  await zoom.selectOption("1");
  await panel.getByRole("button", { name: "保存した表示位置", exact: true }).click();
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("2");
  await expect(zoom).toHaveValue("1.5");
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(400, 0);
});

test("bookmark navigation accounts for source CropBox and page rotation", async ({ page }) => {
  await page.goto("/"); await open(page, await locationFixture(true));
  await page.locator(".bookmark-panel").getByRole("button", { name: "位置と倍率", exact: true }).click();
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("ズーム", { exact: true })).toHaveValue("2.5");
  await expect.poll(async () => (await visiblePagePoint(page, 1, 1000)).y).toBeCloseTo(200, 0);
  await expect.poll(async () => (await visiblePagePoint(page, 1, 1000)).x).toBeCloseTo(300, 0);
  await page.locator(".bookmark-panel").getByRole("button", { name: "表示位置にしおり", exact: true }).click();
  await expect.poll(async () => Number(await page.getByLabel("しおりの左位置", { exact: true }).inputValue())).toBeCloseTo(250, 0);
  await expect.poll(async () => Number(await page.getByLabel("しおりの上位置", { exact: true }).inputValue())).toBeCloseTo(400, 0);
  await expect(page.getByLabel("しおりの倍率（%）", { exact: true })).toHaveValue("250");
});

test("clamps bookmark navigation to the cropped target page while preserving out-of-bounds PDF coordinates", async ({ page }, info) => {
  await page.goto("/"); await open(page, await locationFixture(false, true));
  const panel = page.locator(".bookmark-panel");
  const bookmark = panel.getByRole("button", { name: "位置と倍率", exact: true });
  const number = page.getByLabel("ページ番号", { exact: true });
  const zoom = page.getByLabel("ズーム", { exact: true });
  await bookmark.click();
  await expect(number).toHaveValue("2");
  await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(500, 0);
  await panel.getByLabel("しおりの倍率（%）", { exact: true }).fill("250");
  for (const [left, top, expectedY, filename] of [
    [-100, 1300, 0, "before-crop.pdf"],
    [800, -200, 999, "after-crop.pdf"],
  ] as const) {
    await panel.getByLabel("しおりの左位置", { exact: true }).fill(String(left));
    await panel.getByLabel("しおりの上位置", { exact: true }).fill(String(top));
    await number.fill("4"); await zoom.selectOption("1");
    await bookmark.click();
    await expect(zoom).toHaveValue("2.5");
    await expect.poll(async () => (await visiblePagePoint(page)).y).toBeCloseTo(expectedY, 0);
    await expect(number).toHaveValue("2");
    const scroll = await page.locator(".viewer-scroll").evaluate((el) => ({
      left: el.scrollLeft, max: el.scrollWidth - el.clientWidth,
    }));
    if (left < 50) expect((await visiblePagePoint(page)).x).toBeCloseTo(0, 0);
    else expect(scroll.left).toBeGreaterThan(scroll.max - 20);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    const saved = info.outputPath(filename); await (await download).saveAs(saved);
    const pdf = await PDFDocument.load(await readFile(saved));
    const dest = pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict)
      .lookup(PDFName.of("First"), PDFDict).lookup(PDFName.of("Dest"), PDFArray);
    expect(dest.get(0).toString()).toBe(pdf.getPage(1).ref.toString());
    expect(dest.get(1).toString()).toBe("/XYZ");
    expect(dest.lookup(2, PDFNumber).asNumber()).toBe(left);
    expect(dest.lookup(3, PDFNumber).asNumber()).toBe(top);
    await expect(number).toHaveValue("2");
  }
});
