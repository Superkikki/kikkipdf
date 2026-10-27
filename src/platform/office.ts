import { invoke, isTauri } from "@tauri-apps/api/core";
import { withAbort } from "../commands/abort";

export type OfficeInput = "docx" | "xlsx" | "pptx";
const formats: Record<OfficeInput, number> = { docx: 1, xlsx: 2, pptx: 3 };
const MAX_INPUT = 32 * 1024 * 1024;

export async function convertOffice(
  format: OfficeInput,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!isTauri()) throw Error("Office変換はWindowsデスクトップ版で利用できます。");
  if (!bytes.length || bytes.length > MAX_INPUT) throw Error("変換するファイルは32MBまでです。");
  if (signal.aborted) throw new DOMException("キャンセル", "AbortError");
  const payload = new Uint8Array(bytes.length + 1);
  payload[0] = formats[format];
  payload.set(bytes, 1);
  return new Uint8Array(await withAbort(invoke<ArrayBuffer>("convert_office", payload), signal));
}
