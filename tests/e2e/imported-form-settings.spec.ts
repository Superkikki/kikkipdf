import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { openProject } from "../../src/state/project";

async function fixture() {
  const pdf = await PDFDocument.create(),
    a = pdf.addPage(),
    b = pdf.addPage();
  const text = pdf.getForm().createTextField("SharedName");
  text.setText("Original");
  text.setMaxLength(12);
  text.addToPage(a, { x: 40, y: 620, width: 220, height: 70 });
  text.addToPage(b, { x: 40, y: 620, width: 220, height: 70 });
  const list = pdf.getForm().createOptionList("Tags");
  list.setOptions(["One", "Two", "Three"]);
  list.enableMultiselect();
  list.select(["One", "Three"]);
  list.addToPage(a, { x: 40, y: 480, width: 220, height: 90 });
  return Buffer.from(await pdf.save());
}
async function open(page: Page, file?: string) {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles(
    file ?? {
      name: "settings.pdf",
      mimeType: "application/pdf",
      buffer: await fixture(),
    },
  );
}
async function design(page: Page, name = "SharedName") {
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  await page
    .getByRole("button", { name: "フォームを作成・編集", exact: true })
    .click();
  await selectField(page, name);
}
async function selectField(page: Page, name: string) {
  const selector = page.getByLabel("既存の入力欄", { exact: true });
  const option = selector
    .locator("option")
    .filter({ hasText: `${name} — ページ1` });
  await expect(option).toHaveCount(1);
  await selector.selectOption((await option.getAttribute("value"))!);
}

test("changes shared imported settings with undo, project restoration and PDF round trips", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await design(page);
  await page.getByLabel("既存フィールド最大文字数", { exact: true }).fill("3");
  await page.getByRole("button", { name: "設定を適用", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("現在の入力値より短い");
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  await page
    .getByLabel("既存フィールド名", { exact: true })
    .fill("RenamedName");
  await page.getByLabel("既存フィールド必須", { exact: true }).check();
  await page.getByLabel("既存フィールド読み取り専用", { exact: true }).check();
  await page.getByLabel("既存フィールド複数行", { exact: true }).check();
  await page.getByLabel("既存フィールド最大文字数", { exact: true }).fill("30");
  await page.getByRole("button", { name: "設定を適用", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "設定を適用", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "既存フォーム編集を元に戻す", exact: true })
    .click();
  await expect(
    page.getByLabel("既存フィールド名", { exact: true }),
  ).toHaveValue("SharedName");
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  await page
    .getByRole("button", { name: "既存フォーム編集をやり直す", exact: true })
    .click();
  await expect(
    page.getByLabel("既存フィールド名", { exact: true }),
  ).toHaveValue("RenamedName");
  await page
    .getByRole("button", { name: "元の設定に戻す", exact: true })
    .click();
  await expect(
    page.getByLabel("既存フィールド最大文字数", { exact: true }),
  ).toHaveValue("12");
  await page
    .getByRole("button", { name: "既存フォーム編集を元に戻す", exact: true })
    .click();
  await page.locator(".imported-form-settings").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("imported-form-settings.png"),
  });
  await page.getByRole("button", { name: "値を入力", exact: true }).click();
  const input = page
    .locator("dialog")
    .getByLabel("RenamedName", { exact: true });
  await expect(input).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "完了", exact: true }).click();
  const direct = page
    .locator(".viewer-scroll .imported-form-controls")
    .getByLabel("RenamedName", { exact: true });
  await expect(direct.first()).toHaveAttribute("readonly", "");
  await page
    .locator(".viewer-scroll .page-view")
    .nth(1)
    .scrollIntoViewIfNeeded();
  const secondPageInput = page
    .locator(".viewer-scroll .page-view")
    .nth(1)
    .getByLabel("RenamedName", { exact: true });
  await expect(secondPageInput).toHaveValue("Original");
  await expect(secondPageInput).toHaveAttribute("readonly", "");

  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page
    .getByRole("button", { name: "編集プロジェクトを保存", exact: true })
    .click();
  const project = info.outputPath("settings.kpdf");
  await (await download).saveAs(project);
  const restored = await openProject(new Uint8Array(await readFile(project)));
  expect(Object.values(restored.importedFormEdits!)[0]).toMatchObject({
    name: "RenamedName",
    readOnly: true,
    required: true,
    multiline: true,
    maxLength: 30,
  });
  await page.reload();
  await open(page, project);
  await expect(direct.first()).toHaveValue("Original");
  await design(page, "RenamedName");
  await page
    .getByLabel("既存フィールド読み取り専用", { exact: true })
    .uncheck();
  await page.getByRole("button", { name: "設定を適用", exact: true }).click();
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await direct.first().fill("Changed\nSecond line");
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const dest = info.outputPath("settings-edited.pdf");
  await (await download).saveAs(dest);
  const pdf = await PDFDocument.load(await readFile(dest)),
    field = pdf.getForm().getTextField("RenamedName");
  expect(field.getText()).toBe("Changed\nSecond line");
  expect(field.isRequired()).toBe(true);
  expect(field.isReadOnly()).toBe(false);
  expect(field.isMultiline()).toBe(true);
  expect(field.getMaxLength()).toBe(30);
  expect(field.acroField.getWidgets()).toHaveLength(2);
  await page.reload();
  await open(page, dest);
  await expect(direct.first()).toHaveValue("Changed\nSecond line");
  await direct.first().fill("Edited again");
  await expect(direct.first()).toHaveValue("Edited again");
  expect(errors).toEqual([]);
});

test("validates options, applies choices to live input and saves an editable list", async ({
  page,
}, info) => {
  await open(page);
  await design(page, "Tags");
  const options = page.getByLabel("既存フィールド選択肢", { exact: true });
  await options.fill("One\nOne");
  await page.getByRole("button", { name: "設定を適用", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("重複");
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  await options.fill("One\nFour\nFive");
  await page.getByRole("button", { name: "設定を適用", exact: true }).click();
  await page.getByRole("button", { name: "値を入力", exact: true }).click();
  const tags = page.locator("dialog").getByLabel("Tags", { exact: true });
  await expect(tags).toHaveValues(["One"]);
  await expect(tags.locator("option")).toHaveText(["One", "Four", "Five"]);
  await tags.selectOption(["Four", "Five"]);
  await page
    .getByRole("button", { name: "フォームを作成・編集", exact: true })
    .click();
  await selectField(page, "Tags");
  await page.getByLabel("既存フィールド複数選択", { exact: true }).uncheck();
  await page.getByRole("button", { name: "設定を適用", exact: true }).click();
  await page.getByRole("button", { name: "値を入力", exact: true }).click();
  await expect(tags).toHaveValue("Four");
  await page.getByRole("button", { name: "完了", exact: true }).click();
  const live = page
    .locator(".viewer-scroll .imported-form-controls")
    .getByLabel("Tags", { exact: true });
  await expect(live).toHaveValue("Four");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const dest = info.outputPath("choice-edited.pdf");
  await (await download).saveAs(dest);
  const list = (await PDFDocument.load(await readFile(dest)))
    .getForm()
    .getOptionList("Tags");
  expect(list.getOptions()).toEqual(["One", "Four", "Five"]);
  expect(list.getSelected()).toEqual(["Four"]);
  expect(list.isMultiselect()).toBe(false);
  await page.reload();
  await open(page, dest);
  await expect(live).toHaveValue("Four");
  await live.selectOption("Five");
  await expect(live).toHaveValue("Five");
});
