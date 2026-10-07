import { test, expect } from "@playwright/test";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { blankPage, emptyDocument, newObject } from "../../src/state/model";
import { saveProject } from "../../src/state/project";

test("right-click deletes the clicked shape, supports undo/redo, and saves only the remaining shape", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "新規作成", exact: true }).click();
  await page.getByLabel("ズーム", { exact: true }).selectOption("0.5");
  await expect(
    page.locator(".viewer-scroll .page-view[data-rendered=true]"),
  ).toBeVisible();
  const bounds = await page.locator(".viewer-scroll .page-view").boundingBox();
  if (!bounds) throw Error("Missing page");
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.mouse.click(bounds.x + 40, bounds.y + 60);
  const rectangle = page.locator(".viewer-scroll .object-layer > g").first();
  const id = await rectangle.getAttribute("data-object-id");
  await page.getByRole("button", { name: "円", exact: true }).click();
  await page.mouse.click(bounds.x + 180, bounds.y + 180);
  const objects = page.locator(".viewer-scroll .object-layer > g");
  await expect(objects).toHaveCount(2);
  await rectangle.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "オブジェクトの操作" });
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "コピー", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: info.outputPath("right-click-menu.png") });
  await menu.getByRole("menuitem", { name: "削除", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(objects).toHaveCount(1);
  await expect(
    page.locator(`.viewer-scroll g[data-object-id="${id}"]`),
  ).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(objects).toHaveCount(2);
  await page.keyboard.press("Control+y");
  await expect(objects).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const output = info.outputPath("without-rectangle.pdf");
  await (await download).saveAs(output);
  const pdf = await PDFDocument.load(await readFile(output));
  const streams = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, o]) =>
      o instanceof PDFRawStream
        ? [Buffer.from(decodePDFRawStream(o).decode()).toString()]
        : [],
    );
  expect(streams.join("\n")).not.toMatch(/\bre\b/);
  expect(streams.join("\n")).toMatch(/\bc\b/);
  expect(errors).toEqual([]);
});

test("context menu targets a rotated second page, works during drawing, stays inside the window and dismisses safely", async ({
  page,
}) => {
  const d = emptyDocument("context.pdf");
  d.pages = [0, 1].map((i) => ({
    ...blankPage(),
    width: 420,
    height: 280,
    rotation: i === 1 ? 90 : 0,
    objects: [{ ...newObject("rect", 50, 60), width: 100, height: 80 }],
  }));
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "context.kpdf",
    mimeType: "application/zip",
    buffer: Buffer.from(await saveProject(d)),
  });
  await page.getByLabel("ズーム", { exact: true }).selectOption("0.5");
  const shape = page.locator(
    `.viewer-scroll g[data-object-id="${d.pages[1].objects[0].id}"]`,
  );
  await expect(shape).toBeVisible();
  const undo = page.getByTitle("元に戻す (Ctrl+Z)", { exact: true });
  await expect(undo).toBeDisabled();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const box = await shape.boundingBox();
  if (!box) throw Error("Missing shape");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right",
  });
  const menu = page.getByRole("menu", { name: "オブジェクトの操作" });
  await expect(menu).toBeVisible();
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("2");
  await expect(undo).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await expect(undo).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(shape).toBeFocused();
  await shape.click({ button: "right" });
  await expect(menu).toBeVisible();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  const viewport = page.viewportSize()!;
  await shape.evaluate(
    (el, point) =>
      el.dispatchEvent(
        new MouseEvent("contextmenu", {
          clientX: point.x,
          clientY: point.y,
          button: 2,
          bubbles: true,
          cancelable: true,
        }),
      ),
    { x: viewport.width - 2, y: viewport.height - 2 },
  );
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox!.x).toBeGreaterThanOrEqual(8);
  expect(menuBox!.y).toBeGreaterThanOrEqual(8);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height - 8);
  await page.keyboard.press("Delete");
  await expect(menu).toHaveCount(0);
  await expect(shape).toHaveCount(0);
  await expect(
    page.locator(
      `.viewer-scroll g[data-object-id="${d.pages[0].objects[0].id}"]`,
    ),
  ).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(shape).toBeVisible();
  await expect(undo).toBeDisabled();
  await shape.click({ button: "right" });
  await expect(menu).toBeVisible();
  await page.locator(".viewer-scroll").dispatchEvent("scroll");
  await expect(menu).toHaveCount(0);
});

test("context actions share the keyboard clipboard, change stacking, and edit text in place", async ({ page }) => {
  const d = emptyDocument("actions.pdf");
  const rect = { ...newObject("rect", 40, 50), width: 100, height: 70 };
  const ellipse = { ...newObject("ellipse", 210, 50), width: 100, height: 70 };
  const text = { ...newObject("text", 40, 180), text: "右クリックで編集", width: 240, height: 50 };
  d.pages = [{ ...blankPage(), objects: [rect, ellipse, text] }];
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "actions.kpdf", mimeType: "application/zip", buffer: Buffer.from(await saveProject(d)) });
  await page.getByLabel("ズーム", { exact: true }).selectOption("0.5");
  const objects = page.locator(".viewer-scroll .object-layer > g");
  const shape = (id: string) => page.locator(`.viewer-scroll g[data-object-id="${id}"]`);
  const menu = page.getByRole("menu", { name: "オブジェクトの操作" });
  const item = (name: string) => menu.getByRole("menuitem", { name, exact: true });
  await shape(rect.id).click({ button: "right" });
  await expect(item("貼り付け")).toBeDisabled();
  await page.keyboard.press("ArrowDown");
  await expect(item("切り取り")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(item("コピー")).toBeFocused();
  await item("コピー").click();
  await expect(menu).toHaveCount(0);
  await page.keyboard.press("Control+v");
  await expect(objects).toHaveCount(4);
  await page.keyboard.press("Control+z");
  await expect(objects).toHaveCount(3);
  await shape(rect.id).click({ button: "right" });
  await item("最前面へ").click();
  await expect(objects.last()).toHaveAttribute("data-object-id", rect.id);
  await page.keyboard.press("Control+z");
  await expect(objects.first()).toHaveAttribute("data-object-id", rect.id);
  await shape(ellipse.id).click({ button: "right" });
  await item("複製").click();
  await expect(objects).toHaveCount(4);
  await page.keyboard.press("Control+z");
  await expect(objects).toHaveCount(3);
  await shape(ellipse.id).click({ button: "right" });
  await item("切り取り").click();
  await expect(shape(ellipse.id)).toHaveCount(0);
  await shape(rect.id).click({ button: "right" });
  await item("貼り付け").click();
  await expect(objects).toHaveCount(3);
  await expect(objects.last().locator("ellipse")).toHaveCount(1);
  await shape(text.id).click({ button: "right" });
  await item("文字を編集").click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".inline-text-editor")).toBeVisible();
});
