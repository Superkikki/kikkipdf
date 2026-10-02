import { test, expect, type Page } from "@playwright/test";
import { PDFArray, PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { openProject } from "../../src/state/project";
async function fixture(cropped = false, merged = false) {
  const pdf = await PDFDocument.create(),
    p = pdf.addPage([420, 595]);
  p.drawRectangle({
    x: 0,
    y: 0,
    width: 420,
    height: 595,
    color: rgb(0.2, 0.6, 0.8),
  });
  p.drawRectangle({
    x: 80,
    y: 480,
    width: 100,
    height: 100,
    color: rgb(0.8, 0.7, 0.2),
  });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const neighbourFont = await pdf.embedFont(StandardFonts.TimesRoman);
  // Independent Tj commands inside one text object exercise downstream placement.
  const streams = p.node.Contents();
  const raw = pdf.context.flateStream(
    `BT /F1 20 Tf 1 0 0 1 40 520 Tm (Editable original) Tj /${merged ? "F1" : "F2"} 20 Tf ( Neighbour) Tj ET`,
  );
  p.node.set(
    PDFName.of("Resources"),
    pdf.context.obj({ Font: { F1: font.ref, F2: neighbourFont.ref } }),
  );
  p.node.set(
    PDFName.of("Contents"),
    pdf.context.obj([
      ...(streams instanceof PDFArray ? streams.asArray() : [streams!]),
      pdf.context.register(raw),
    ]),
  );
  if (cropped) p.setCropBox(20, 30, 380, 550);
  return Buffer.from(await pdf.save());
}
async function open(page: Page, buffer: Buffer, name = "direct.pdf") {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: name.endsWith(".pdf") ? "application/pdf" : "application/zip",
    buffer,
  });
  await expect(
    page.locator(".viewer-scroll .page-view[data-rendered=true]").first(),
  ).toBeVisible();
}
const original = (page: Page) =>
  page
    .locator(".viewer-scroll .textLayer span")
    .filter({ hasText: /^Editable original$/ });
test("direct edit removes source glyphs without covering backgrounds, preserving neighbours, search, undo and saved PDF", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await open(page, await fixture());
  const neighbour = page
    .locator(".viewer-scroll .textLayer span")
    .filter({ hasText: /Neighbour/ });
  const before = await neighbour.boundingBox();
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await original(page).dblclick();
  await expect(page.locator(".properties")).toContainText(
    "既存テキストを直接編集",
  );
  await expect(original(page)).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(original(page)).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(original(page)).toHaveCount(0);
  await page.getByLabel("テキスト内容").fill("Changed direct text");
  const overlay = page.locator(
    ".viewer-scroll .editable-text[data-layout-ready=true]",
  );
  await expect(overlay).toHaveText("Changed direct text");
  const after = await neighbour.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 1);
  expect(after!.y).toBeCloseTo(before!.y, 1);
  await expect(
    page.locator(".viewer-scroll .page-view[data-rendered=true]"),
  ).toBeVisible();
  const background = await page
    .locator(".viewer-scroll canvas")
    .first()
    .evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d")!;
      return [45, 95].map((x) =>
        Array.from(
          ctx.getImageData(
            Math.round((x * canvas.width) / 420),
            Math.round((65 * canvas.height) / 595),
            1,
            1,
          ).data,
        ).slice(0, 3),
      );
    });
  expect(background).toEqual([
    [51, 153, 204],
    [204, 178, 51],
  ]);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByLabel("PDF内を検索").fill("Editable original");
  await expect(page.locator(".search-count")).toContainText("0 / 0 件");
  await page.getByLabel("PDF内を検索").fill("Changed direct text");
  await expect(page.locator(".search-count")).toContainText("1 / 1 件");
  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page
    .getByRole("button", { name: "編集プロジェクトを保存", exact: true })
    .click();
  const project = info.outputPath("direct.kpdf");
  await (await download).saveAs(project);
  const reopened = await openProject(new Uint8Array(await readFile(project)));
  expect(reopened.pages[0].objects[0].kind).toBe("direct-text");
  expect(reopened.pages[0].objects[0].sourceText!.originalText).toBe(
    "Editable original",
  );
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("direct.pdf");
  await (await download).saveAs(saved);
  await page.reload();
  await open(page, await readFile(saved));
  await expect(page.locator(".viewer-scroll .textLayer")).toContainText(
    "Changed direct text",
  );
  await expect(original(page)).toHaveCount(0);
  await expect(neighbour).toBeVisible();
  await page.reload();
  await open(page, await readFile(project), "direct.kpdf");
  await expect(original(page)).toHaveCount(0);
  await expect(overlay).toHaveText("Changed direct text");
  await page.locator(".viewer-scroll .object-layer > g").first().click();
  await page
    .getByRole("button", { name: "元の文字に戻す", exact: true })
    .click();
  await expect(original(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("direct edit and delete work on a rotated page with original CropBox", async ({
  page,
}, info) => {
  await page.goto("/");
  await open(page, await fixture(true));
  await page.getByRole("button", { name: "ページ管理", exact: true }).click();
  await page.getByRole("button", { name: "回転", exact: true }).click();
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await original(page).dblclick();
  await expect(page.getByLabel("テキスト内容")).toHaveValue(
    "Editable original",
  );
  await page.getByLabel("テキスト内容").fill("Rotated edit");
  await page
    .locator(".properties")
    .getByRole("button", { name: "削除", exact: true })
    .click();
  await expect(original(page)).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("deleted.pdf");
  await (await download).saveAs(saved);
  expect(
    (await PDFDocument.load(await readFile(saved))).getPage(0).getRotation()
      .angle,
  ).toBe(90);
  await page.reload();
  await open(page, await readFile(saved));
  await expect(original(page)).toHaveCount(0);
  await expect(page.locator(".viewer-scroll .textLayer")).toContainText(
    "Neighbour",
  );
});
test("unsupported Form XObject text is explicitly refused and appearance replacement remains opt-in", async ({
  page,
}) => {
  const inner = await PDFDocument.create();
  inner
    .addPage([420, 595])
    .drawText("Editable original", { x: 40, y: 520, size: 20 });
  const doc = await PDFDocument.create();
  doc.addPage([420, 595]).drawPage(await doc.embedPage(inner.getPage(0)));
  await page.goto("/");
  await open(page, Buffer.from(await doc.save()));
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await original(page).dblclick();
  await expect(page.getByRole("alert")).toContainText("Form XObject");
  await expect(page.locator(".viewer-scroll .editable-text")).toHaveCount(0);
  await expect(original(page)).toBeVisible();
  await page.getByRole("button", { name: "見た目の置換", exact: true }).click();
  await original(page).dblclick();
  await expect(page.locator(".properties")).toContainText(
    "元の文字情報は残ります",
  );
  await page.getByLabel("テキスト内容").fill("Appearance replacement");
  await expect(original(page)).toHaveCount(1);
});
test("edits a PDF.js span assembled from multiple adjacent text drawing operations", async ({
  page,
}, info) => {
  await page.goto("/");
  await open(page, await fixture(false, true));
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await page
    .locator(".viewer-scroll .textLayer span")
    .filter({ hasText: /^Editable original Neighbour$/ })
    .dblclick();
  await expect(page.getByLabel("テキスト内容")).toHaveValue(
    "Editable original Neighbour",
  );
  await page.getByLabel("テキスト内容").fill("Merged replacement");
  await expect(page.locator(".viewer-scroll .textLayer span")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("merged.pdf");
  await (await download).saveAs(saved);
  await page.reload();
  await open(page, await readFile(saved));
  await expect(page.locator(".viewer-scroll .textLayer")).toContainText(
    "Merged replacement",
  );
  await expect(page.locator(".viewer-scroll .textLayer")).not.toContainText(
    "Editable original",
  );
});
