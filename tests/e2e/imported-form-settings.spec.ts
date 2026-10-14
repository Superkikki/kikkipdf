import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFName, PDFHexString } from "pdf-lib";
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
    .filter({ hasText: `${name} — ページ1` }).first();
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

test("edits paired display labels and export values without losing dropdown or list selections", async ({
  page,
}, info) => {
  const { PDFHexString, PDFName, PDFArray } = await import("pdf-lib");
  const input = await PDFDocument.create(),
    sheet = input.addPage();
  for (const kind of ["dropdown", "list"] as const) {
    const field =
      kind === "dropdown"
        ? input.getForm().createDropdown("ColorCode")
        : input.getForm().createOptionList("TagCode");
    field.setOptions(["Red", "Green", "Blue"]);
    field.addToPage(sheet, {
      x: 40,
      y: kind === "dropdown" ? 650 : 450,
      width: 220,
      height: 80,
    });
    if (kind === "list") field.enableMultiselect();
    field.acroField.setOptions(
      ["Red", "Green", "Blue"].map((label) => ({
        value: PDFHexString.fromText(label[0]),
        display: PDFHexString.fromText(label),
      })),
    );
    field.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("G"));
  }
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "paired.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await input.save({ updateFieldAppearances: false })),
  });
  const direct = page.locator(".viewer-scroll .form-page-overlay");
  await expect(direct.getByLabel("ColorCode", { exact: true })).toHaveValue(
    "G",
  );
  await expect(
    direct.getByLabel("ColorCode", { exact: true }).locator("option:checked"),
  ).toHaveText("Green");
  await direct.getByLabel("ColorCode", { exact: true }).selectOption("R");
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  const dialog = page.locator("dialog");
  await expect(dialog.getByLabel("ColorCode", { exact: true })).toHaveValue(
    "R",
  );
  await expect(dialog.getByLabel("TagCode", { exact: true })).toHaveValues([
    "G",
  ]);
  await dialog.getByLabel("TagCode", { exact: true }).selectOption(["R", "B"]);
  await page
    .getByRole("button", { name: "フォームを作成・編集", exact: true })
    .click();
  await selectField(page, "ColorCode");
  await page.getByLabel("選択肢1の表示名", { exact: true }).fill("赤色");
  await page.getByLabel("選択肢2の保存値", { exact: true }).fill("R");
  await page.getByRole("button", { name: "設定を適用", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("重複");
  await page.getByLabel("選択肢2の保存値", { exact: true }).fill("G");
  await page.getByRole("button", { name: "選択肢を追加", exact: true }).click();
  await page.getByLabel("選択肢4の表示名", { exact: true }).fill("黄色");
  await page.getByLabel("選択肢4の保存値", { exact: true }).fill("Y");
  await page.getByRole("button", { name: "設定を適用", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "値を入力", exact: true }).click();
  await expect(
    dialog.getByLabel("ColorCode", { exact: true }).locator("option:checked"),
  ).toHaveText("赤色");
  await dialog.getByLabel("ColorCode", { exact: true }).selectOption("Y");
  await page.getByRole("button", { name: "完了", exact: true }).click();
  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page
    .getByRole("button", { name: "編集プロジェクトを保存", exact: true })
    .click();
  const projectPath = info.outputPath("paired.kpdf");
  await (await download).saveAs(projectPath);
  const restored = await openProject(
    new Uint8Array(await readFile(projectPath)),
  );
  expect(
    Object.values(restored.importedFormEdits!)[0].choiceOptions?.[0],
  ).toEqual({ value: "R", label: "赤色" });
  await page.reload();
  await open(page, projectPath);
  await expect(direct.getByLabel("ColorCode", { exact: true })).toHaveValue(
    "Y",
  );
  await expect(
    direct.getByLabel("ColorCode", { exact: true }).locator("option:checked"),
  ).toHaveText("黄色");
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const dest = info.outputPath("paired-edited.pdf");
  await (await download).saveAs(dest);
  const saved = await PDFDocument.load(await readFile(dest));
  expect(saved.getForm().getDropdown("ColorCode").getSelected()).toEqual(["Y"]);
  expect(saved.getForm().getDropdown("ColorCode").getOptions()).toEqual([
    "赤色",
    "Green",
    "Blue",
    "黄色",
  ]);
  expect(saved.getForm().getDropdown("ColorCode").isEditable()).toBe(false);
  expect(saved.getForm().getOptionList("TagCode").getSelected()).toEqual([
    "R",
    "B",
  ]);
  expect(
    saved
      .getForm()
      .getOptionList("TagCode")
      .acroField.dict.lookup(PDFName.of("I"), PDFArray)
      .toString(),
  ).toBe("[ 0 2 ]");
  await page.reload();
  await open(page, dest);
  await expect(direct.getByLabel("ColorCode", { exact: true })).toHaveValue(
    "Y",
  );
  await expect(direct.getByLabel("TagCode", { exact: true })).toHaveValues([
    "R",
    "B",
  ]);
  expect(errors).toEqual([]);
});

test("renames radio export values and keeps selection on the same widget through saving", async ({ page }, info) => {
  const pdf = await PDFDocument.create(), sheet = pdf.addPage();
  const field = pdf.getForm().createRadioGroup("Answer");
  field.addOptionToPage("A", sheet, { x: 40, y: 620, width: 20, height: 20 });
  field.addOptionToPage("B", sheet, { x: 40, y: 570, width: 20, height: 20 }); field.select("B");
  await page.goto("/"); const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "radio.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await design(page, "Answer");
  await page.getByLabel("既存フィールド選択肢", { exact: true }).fill("First\nSecond");
  await page.getByRole("button", { name: "設定を適用", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "完了", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const path = info.outputPath("radio-renamed.pdf"); await (await download).saveAs(path);
  const saved = (await PDFDocument.load(await readFile(path))).getForm().getRadioGroup("Answer");
  expect(saved.getOptions()).toEqual(["First", "Second"]); expect(saved.getSelected()).toBe("Second");
  await open(page, path); await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Second", exact: true })).toBeChecked();
});

test("duplicates independently and deletes/restores shared fields across pages with history and saved PDF/project round trips", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await open(page); await design(page);
  await page.getByRole("button", { name: "独立した項目として複製", exact: true }).click();
  await page.getByLabel("作成したフィールド", { exact: true }).selectOption({ label: "SharedName_copy" });
  await expect(page.getByLabel("フィールド名", { exact: true })).toHaveValue("SharedName_copy");
  await page.getByRole("button", { name: "値を入力", exact: true }).click();
  const dialog = page.locator("dialog");
  await dialog.getByLabel("SharedName_copy", { exact: true }).fill("Independent");
  await expect(dialog.getByLabel("SharedName", { exact: true })).toHaveValue("Original");
  await page.getByRole("button", { name: "フォームを作成・編集", exact: true }).click(); await selectField(page, "SharedName");
  await page.getByRole("button", { name: "項目を全ページから削除", exact: true }).click();
  await expect(page.getByRole("button", { name: "削除した項目を復元", exact: true })).toBeVisible();
  await expect(page.getByLabel("既存の入力欄", { exact: true }).locator("option").filter({ hasText: "（削除済み）" })).toHaveCount(2);
  await expect(page.locator(".form-edit-widget").filter({ hasText: "SharedName" })).toHaveCount(0);
  await page.getByRole("button", { name: "既存フォーム編集を元に戻す", exact: true }).click();
  await expect(page.getByRole("button", { name: "項目を全ページから削除", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "既存フォーム編集をやり直す", exact: true }).click();
  await page.getByRole("button", { name: "削除した項目を復元", exact: true }).click();
  await expect(page.getByLabel("既存の入力欄", { exact: true }).locator("option").filter({ hasText: "（削除済み）" })).toHaveCount(0);
  await page.getByRole("button", { name: "項目を全ページから削除", exact: true }).click();
  await page.getByRole("button", { name: "値を入力", exact: true }).click();
  await expect(dialog.getByLabel("SharedName", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("SharedName_copy", { exact: true })).toHaveValue("Independent");
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "フォーム値をXFDF保存", exact: true }).click();
  const xfdf = info.outputPath("deleted.xfdf"); await (await download).saveAs(xfdf);
  expect(await readFile(xfdf, "utf8")).not.toContain('name="SharedName"');
  await page.getByRole("button", { name: "完了", exact: true }).click();
  download = page.waitForEvent("download"); await page.getByText("ファイル", { exact: true }).click();
  await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const project = info.outputPath("deleted.kpdf"); await (await download).saveAs(project);
  const model = await openProject(new Uint8Array(await readFile(project)));
  expect(Object.values(model.importedFormEdits ?? {}).some(edit => edit.deleted)).toBe(true);
  expect(model.formFields![0].value).toBe("Independent");
  download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const output = info.outputPath("deleted.pdf"); await (await download).saveAs(output);
  const pdf = await PDFDocument.load(await readFile(output));
  expect(pdf.getForm().getFields().map(field => field.getName())).toEqual(["Tags", "SharedName_copy"]);
  expect(pdf.getForm().getTextField("SharedName_copy").getText()).toBe("Independent");
  await page.reload(); await open(page, project); await design(page);
  await expect(page.getByRole("button", { name: "削除した項目を復元", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "削除した項目を復元", exact: true }).click();
  await page.getByRole("button", { name: "値を入力", exact: true }).click();
  await expect(dialog.getByLabel("SharedName", { exact: true })).toHaveValue("Original");
  await expect(dialog.getByLabel("SharedName_copy", { exact: true })).toHaveValue("Independent");
  expect(errors).toEqual([]);
});
test("copies paired choice labels and export values and edits the independent copy without changing the source", async ({ page }, info) => {
  const input = await PDFDocument.create(), sheet = input.addPage();
  const choice = input.getForm().createDropdown("Color"); choice.setOptions(["Red", "Green"]);
  choice.addToPage(sheet, { x: 40, y: 600, width: 200, height: 30 });
  choice.acroField.setOptions([{ value: PDFHexString.fromText("R"), display: PDFHexString.fromText("Red") },
    { value: PDFHexString.fromText("G"), display: PDFHexString.fromText("Green") }]);
  choice.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("G"));
  choice.acroField.dict.set(PDFName.of("DV"), PDFHexString.fromText("G"));
  await page.goto("/"); const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "paired.pdf", mimeType: "application/pdf", buffer: Buffer.from(await input.save({ updateFieldAppearances: false })) });
  await design(page, "Color");
  await page.getByRole("button", { name: "独立した項目として複製", exact: true }).click();
  await page.getByLabel("作成したフィールド", { exact: true }).selectOption({ label: "Color_copy" });
  await expect(page.getByLabel("追加選択肢2の保存値", { exact: true })).toHaveValue("G");
  await page.getByLabel("追加選択肢2の表示名", { exact: true }).fill("Grass");
  await page.getByRole("button", { name: "値を入力", exact: true }).click();
  const dialog = page.locator("dialog");
  await expect(dialog.getByLabel("Color_copy", { exact: true })).toHaveValue("G");
  await expect(dialog.getByLabel("Color_copy", { exact: true }).locator("option:checked")).toHaveText("Grass");
  await expect(dialog.getByLabel("Color", { exact: true }).locator("option:checked")).toHaveText("Green");
  await dialog.getByLabel("Color_copy", { exact: true }).selectOption("R");
  await expect(dialog.getByLabel("Color", { exact: true })).toHaveValue("G");
  await page.getByRole("button", { name: "入力値をPDFの既定値に戻す", exact: true }).click();
  await expect(dialog.getByLabel("Color_copy", { exact: true })).toHaveValue("G");
  await page.getByRole("button", { name: "完了", exact: true }).click();
  let download = page.waitForEvent("download"); await page.getByText("ファイル", { exact: true }).click();
  await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const project = info.outputPath("paired-copy.kpdf"); await (await download).saveAs(project);
  const model = await openProject(new Uint8Array(await readFile(project)));
  expect(model.formFields![0].choiceOptions?.[1]).toEqual({ value: "G", label: "Grass" });
  download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const output = info.outputPath("paired-copy.pdf"); await (await download).saveAs(output);
  const pdf = await PDFDocument.load(await readFile(output));
  expect(pdf.getForm().getDropdown("Color_copy").getSelected()).toEqual(["G"]);
  expect(pdf.getForm().getDropdown("Color_copy").getOptions()).toEqual(["Red", "Grass"]);
  expect(pdf.getForm().getDropdown("Color").getOptions()).toEqual(["Red", "Green"]);
  await page.reload(); await open(page, output); await design(page, "Color_copy");
  await expect(page.getByLabel("選択肢2の保存値", { exact: true })).toHaveValue("G");
  await expect(page.getByLabel("選択肢2の表示名", { exact: true })).toHaveValue("Grass");
});
