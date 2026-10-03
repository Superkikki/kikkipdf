import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
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
