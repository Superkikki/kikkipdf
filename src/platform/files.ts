import { invoke, isTauri } from "@tauri-apps/api/core";
export { isTauri };
export interface LocalFile {
  name: string;
  path?: string;
  bytes: Uint8Array;
}
export async function pickFiles(
  kind: "pdf" | "batchPdf" | "image" | "project" | "attachment" | "font" | "xfdf" | "csv" | "json" = "pdf",
  multiple = false,
): Promise<LocalFile[]> {
  if (isTauri()) {
    const paths = await invoke<string[]>("select_files", { kind, multiple });
    if (kind === "batchPdf") {
      if (paths.length > 50) throw Error("一括処理は50ファイルまでです。");
      const files: LocalFile[] = []; let total = 0;
      for (const path of paths) {
        const file = await readPath(path, { maxBytes: 32 * 1024 * 1024 });
        total += file.bytes.length;
        if (total > 256 * 1024 * 1024) throw Error("入力の合計は256MBまでです。");
        files.push(file);
      }
      return files;
    }
    return Promise.all(
      paths.map((path) =>
        readPath(
          path,
          kind === "font" ? { maxBytes: 32 * 1024 * 1024 }
            : (kind === "xfdf" || kind === "csv" || kind === "json") ? { maxBytes: 8 * 1024 * 1024 } : undefined,
        ),
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept =
      kind === "batchPdf"
        ? ".pdf"
        : kind === "pdf"
        ? ".pdf,.kpdf"
        : kind === "project"
          ? ".kpdf"
          : kind === "json"
            ? ".json"
            : kind === "csv"
            ? ".csv"
            : kind === "xfdf"
            ? ".xfdf"
            : kind === "font"
              ? ".ttf,.otf"
              : kind === "attachment"
                ? ""
                : ".png,.jpg,.jpeg";
    input.onchange = () => {
      if (kind === "batchPdf") {
        const selected = Array.from(input.files ?? []);
        if (selected.length > 50 || selected.some(f => f.size > 32 * 1024 * 1024) || selected.reduce((sum, f) => sum + f.size, 0) > 256 * 1024 * 1024) {
          reject(Error("一括処理は50件、1件32MB、合計256MBまでです。")); return;
        }
      }
      void Promise.all(
        Array.from(input.files ?? []).map(async (f) => {
          if (kind === "font" && f.size > 32 * 1024 * 1024)
            throw Error("フォントは1件32MBまでです。");
          if ((kind === "xfdf" || kind === "csv" || kind === "json") && f.size > 8 * 1024 * 1024)
            throw Error("読み込みファイルは1件8MBまでです。");
          return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
        }),
      ).then(resolve, reject);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}
export async function readPath(
  path: string,
  options?: { maxBytes: number },
): Promise<LocalFile> {
  const bytes = await invoke<ArrayBuffer>("read_document", {
    path,
    maxBytes: options?.maxBytes,
  });
  return {
    path,
    name: path.split(/[\\/]/).pop() ?? "document.pdf",
    bytes: new Uint8Array(bytes),
  };
}
export async function saveBytes(
  bytes: Uint8Array,
  name: string,
  path?: string,
): Promise<{ name: string; path?: string } | null> {
  if (isTauri()) {
    const token = await invoke<string | null>("prepare_save", {
      name,
      path: path ?? null,
    });
    if (!token) return null;
    const result = await invoke<string>("save_document", bytes, {
      headers: { "x-kikki-token": token },
    });
    return result
      ? { name: result.split(/[\\/]/).pop() ?? name, path: result }
      : null;
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { name };
}
export async function recentPaths(): Promise<string[]> {
  return isTauri() ? invoke("recent_documents") : [];
}
