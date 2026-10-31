import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { saveBytes } from "../src/platform/files";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
const call = vi.mocked(invoke);
const bytes = new Uint8Array([37, 80, 68, 70]);
const original = "C:\\Users\\User\\Downloads\\document.pdf";
const copy = "C:\\Users\\User\\Documents\\edited.pdf";
beforeEach(() => call.mockReset());

it("saves a selected PDF directly using its native write token", async () => {
  call.mockResolvedValueOnce("original-token").mockResolvedValueOnce(original);
  expect(await saveBytes(bytes, "document.pdf", original)).toEqual({ name: "document.pdf", path: original });
  expect(call).toHaveBeenNthCalledWith(1, "prepare_save", { name: "document.pdf", path: original, accessDenied: false });
  expect(call).toHaveBeenNthCalledWith(2, "save_document", bytes, { headers: { "x-kikki-token": "original-token" } });
});

it("offers a copy after an overwrite is denied and saves the same exported bytes with a new token", async () => {
  call.mockResolvedValueOnce("original-token").mockRejectedValueOnce("SAVE_ACCESS_DENIED:ファイルを置き換えできません。")
    .mockResolvedValueOnce("copy-token").mockResolvedValueOnce(copy);
  expect(await saveBytes(bytes, "document.pdf", original)).toEqual({ name: "edited.pdf", path: copy });
  expect(call).toHaveBeenNthCalledWith(3, "prepare_save", { name: "document.pdf", path: null, accessDenied: true });
  expect(call).toHaveBeenNthCalledWith(4, "save_document", bytes, { headers: { "x-kikki-token": "copy-token" } });
});

it("leaves the document unsaved when the copy dialog is cancelled", async () => {
  call.mockResolvedValueOnce("original-token").mockRejectedValueOnce("SAVE_ACCESS_DENIED:denied")
    .mockResolvedValueOnce(null);
  expect(await saveBytes(bytes, "document.pdf", original)).toBeNull();
  expect(call).toHaveBeenCalledTimes(3);
});

it("reports other save failures without opening another dialog", async () => {
  call.mockResolvedValueOnce("original-token").mockRejectedValueOnce("空き容量がありません。");
  await expect(saveBytes(bytes, "document.pdf", original)).rejects.toBe("空き容量がありません。");
  expect(call).toHaveBeenCalledTimes(2);
});

it("reports failure at the replacement destination without repeatedly opening dialogs", async () => {
  call.mockResolvedValueOnce("original-token").mockRejectedValueOnce("SAVE_ACCESS_DENIED:original")
    .mockResolvedValueOnce("copy-token").mockRejectedValueOnce("SAVE_ACCESS_DENIED:別の保存先にも書き込めません。");
  await expect(saveBytes(bytes, "document.pdf", original)).rejects.toThrow("別の保存先にも書き込めません。");
  expect(call).toHaveBeenCalledTimes(4);
});

it("reports a denied explicit Save As without reopening its dialog", async () => {
  call.mockResolvedValueOnce("copy-token").mockRejectedValueOnce("SAVE_ACCESS_DENIED:アクセスが拒否されました。");
  await expect(saveBytes(bytes, "document.pdf")).rejects.toThrow("アクセスが拒否されました。");
  expect(call).toHaveBeenCalledTimes(2);
});
