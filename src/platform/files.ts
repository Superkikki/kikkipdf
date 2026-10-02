import { invoke, isTauri } from "@tauri-apps/api/core";
export { isTauri };
export interface LocalFile {
  name: string;
  path?: string;
  bytes: Uint8Array;
}
export async function pickFiles(
  kind: "pdf" | "image" | "project" | "attachment" | "font" = "pdf",
  multiple = false,
): Promise<LocalFile[]> {
  if (isTauri()) {
    const paths = await invoke<string[]>("select_files", { kind, multiple });
    return Promise.all(
      paths.map((path) =>
        readPath(
          path,
          kind === "font" ? { maxBytes: 32 * 1024 * 1024 } : undefined,
        ),
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept =
      kind === "pdf"
        ? ".pdf,.kpdf"
        : kind === "project"
          ? ".kpdf"
          : kind === "font"
            ? ".ttf,.otf"
            : kind === "attachment"
              ? ""
              : ".png,.jpg,.jpeg";
    input.onchange = () => {
      void Promise.all(
        Array.from(input.files ?? []).map(async (f) => {
          if (kind === "font" && f.size > 32 * 1024 * 1024)
            throw Error("フォントは1件32MBまでです。");
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
