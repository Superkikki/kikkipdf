import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFDict, PDFName, PDFHexString, PDFString } from "pdf-lib";
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
