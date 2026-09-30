import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFDict, PDFName, degrees } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { openProject } from "../../src/state/project";

async function fixture() {
  const input = await PDFDocument.create(),
    first = input.addPage([500, 600]),
    second = input.addPage([500, 600]);
  first.setCropBox(50, 50, 400, 500);
  first.setRotation(degrees(90));
  const name = input.getForm().createTextField("SharedName");
  name.addToPage(first, { x: 90, y: 360, width: 100, height: 30 });
  name.addToPage(second, { x: 90, y: 360, width: 100, height: 30 });
  name.setText("Original");
  return Buffer.from(await input.save());
}
async function open(page: Page) {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "layout.pdf",
    mimeType: "application/pdf",
    buffer: await fixture(),
  });
}
async function design(page: Page) {
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  await page
    .getByRole("button", { name: "フォームを作成・編集", exact: true })
    .click();
  const selector = page.getByLabel("既存の入力欄", { exact: true });
  await expect(selector.locator("option")).toHaveCount(3);
  const first = await selector.locator("option").nth(1).getAttribute("value");
  await selector.selectOption(first!);
}
test("moves and resizes a rotated cropped imported widget, undoes, saves a project and preserves shared input", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const controls = page
    .locator(".viewer-scroll .imported-form-controls")
    .getByLabel("SharedName", { exact: true });
  await expect(controls.first()).toHaveValue("Original");
  await controls.first().fill("Edited directly");
  await page
    .locator(".viewer-scroll .page-view")
    .nth(1)
    .scrollIntoViewIfNeeded();
  await expect(
    page
      .locator(".viewer-scroll .page-view")
      .nth(1)
      .getByLabel("SharedName", { exact: true }),
  ).toHaveValue("Edited directly");
  await page
    .locator(".viewer-scroll .page-view")
    .first()
    .scrollIntoViewIfNeeded();
  await design(page);
  const x = page.getByLabel("既存フィールドx", { exact: true }),
    y = page.getByLabel("既存フィールドy", { exact: true });
  const beforeX = Number(await x.inputValue()),
    beforeY = Number(await y.inputValue());
  const widget = page.locator(
    ".form-layout-preview .form-edit-widget.selected",
  );
  await page
    .locator(".form-layout-preview .page-view")
    .scrollIntoViewIfNeeded();
  await expect(widget).toBeVisible();
  await widget.scrollIntoViewIfNeeded();
  const bounds = (await widget.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 24,
    bounds.y + bounds.height / 2 + 32,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await x.inputValue()))
    .toBeCloseTo(beforeX + 40, 1);
  await expect
    .poll(async () => Number(await y.inputValue()))
    .toBeCloseTo(beforeY - 30, 1);
  await page.keyboard.press("Control+z");
  await expect(x).toHaveValue(String(beforeX));
  await page.keyboard.press("Control+y");
  await expect
    .poll(async () => Number(await x.inputValue()))
    .toBeCloseTo(beforeX + 40, 1);
  const width = page.getByLabel("既存フィールドwidth", { exact: true }),
    height = page.getByLabel("既存フィールドheight", { exact: true });
  const beforeWidth = Number(await width.inputValue()),
    beforeHeight = Number(await height.inputValue());
  const handle = (await widget.locator(".form-resize-handle").boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 - 16,
    handle.y + handle.height / 2 + 24,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await width.inputValue()))
    .toBeCloseTo(beforeWidth + 30, 1);
  await expect
    .poll(async () => Number(await height.inputValue()))
    .toBeCloseTo(beforeHeight + 20, 1);
  await page
    .getByRole("button", { name: "元の配置に戻す", exact: true })
    .click();
  await expect(width).toHaveValue(String(beforeWidth));
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => Number(await width.inputValue()))
    .toBeCloseTo(beforeWidth + 30, 1);
  await page.screenshot({ path: info.outputPath("imported-form-layout.png") });
  await page.getByRole("button", { name: "完了", exact: true }).click();
  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page
    .getByRole("button", { name: "編集プロジェクトを保存", exact: true })
    .click();
  const project = info.outputPath("layout.kpdf");
  await (await download).saveAs(project);
  const restored = await openProject(new Uint8Array(await readFile(project)));
  expect(Object.values(restored.pages[0].formWidgetEdits!)[0]).toMatchObject({
    width: beforeWidth + 30,
    height: beforeHeight + 20,
  });
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const dest = info.outputPath("layout-edited.pdf");
  await (await download).saveAs(dest);
  const saved = await PDFDocument.load(await readFile(dest)),
    field = saved.getForm().getTextField("SharedName");
  expect(field.getText()).toBe("Edited directly");
  expect(field.acroField.getWidgets()).toHaveLength(2);
  expect(field.acroField.getWidgets()[0].getRectangle().width).toBeCloseTo(
    beforeWidth + 30,
  );
  expect(field.acroField.getWidgets()[1].getRectangle().width).toBe(
    beforeWidth,
  );
  await page.reload();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles(dest);
  await expect(controls.first()).toHaveValue("Edited directly");
  await controls.first().fill("Second edit");
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const second = info.outputPath("layout-second.pdf");
  await (await download).saveAs(second);
  expect(
    (await PDFDocument.load(await readFile(second)))
      .getForm()
      .getTextField("SharedName")
      .getText(),
  ).toBe("Second edit");
  expect(errors).toEqual([]);
});

test("numeric placement and flattening use the new bounds and remove all widget annotations", async ({
  page,
}, info) => {
  await open(page);
  await design(page);
  await page.getByLabel("既存フィールドx", { exact: true }).fill("70");
  await page.getByLabel("既存フィールドy", { exact: true }).fill("90");
  await page.getByLabel("既存フィールドwidth", { exact: true }).fill("180");
  await page.getByLabel("既存フィールドheight", { exact: true }).fill("40");
  await page.getByLabel("固定して保存（保存後は再入力不可）").check();
  await page.getByRole("button", { name: "完了", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const dest = info.outputPath("layout-flat.pdf");
  await (await download).saveAs(dest);
  const flat = await PDFDocument.load(await readFile(dest));
  expect(flat.getForm().getFields()).toHaveLength(0);
  for (const sheet of flat.getPages()) {
    const annotations = sheet.node.Annots();
    if (annotations)
      for (let i = 0; i < annotations.size(); i++)
        expect(
          annotations.lookup(i, PDFDict).get(PDFName.of("Subtype"))?.toString(),
        ).not.toBe("/Widget");
  }
  await page.reload();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles(dest);
  await expect(page.locator(".viewer-scroll .textLayer").first()).toContainText(
    "Original",
  );
  const rectangle = await page
    .locator(".viewer-scroll .textLayer")
    .first()
    .locator("span")
    .filter({ hasText: "Original" })
    .evaluate((element) => {
      const rect = element.getBoundingClientRect(),
        content = element.closest(".page-content")!.getBoundingClientRect();
      const scale = content.width / 500;
      return {
        x: (rect.left - content.left) / scale,
        y: (rect.top - content.top) / scale,
      };
    });
  // On a 90° page the text is placed near x=500 - (90 + 40), y=70.
  expect(rectangle.x).toBeGreaterThan(365);
  expect(rectangle.x).toBeLessThan(415);
  expect(rectangle.y).toBeGreaterThan(70);
  expect(rectangle.y).toBeLessThan(90);
});
