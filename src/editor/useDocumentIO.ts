import { documentStore } from "../state/store";
import type { DocumentModel } from "../state/model";
import { mergeDocuments } from "../commands/document";
import { clearRecovery } from "../state/recovery";
import { isTauri, pickFiles, recentPaths, saveBytes, type LocalFile } from "../platform/files";
import { transformPdf } from "../platform/pdfSecurity";
import { importPdf, releasePdfs } from "../viewer/pdf";
import { exportDocument, importProject } from "../export/client";
import type { Ask, Work, Progress } from "./types";

interface DocumentIOOptions {
  ask: Ask;
  work: Work;
  progress: Progress;
  report: (error: string) => void;
  setActive: (id: string) => void;
  setSelected: (id: string | null) => void;
  setRecent: (paths: string[]) => void;
  setStatus: (status: string) => void;
}
export function useDocumentIO(options: DocumentIOOptions) {
  const { ask, work, progress, report, setActive, setSelected, setRecent, setStatus } = options;
  async function mayDiscard() {
    if (!documentStore.history?.dirty) return true;
    return !!(await ask({
      title: "未保存の変更があります",
      message:
        "変更を破棄して続行しますか？ 保存する場合はキャンセルして保存してください。",
      confirm: "変更を破棄",
      danger: true,
    }));
  }
  async function decode(file: LocalFile): Promise<DocumentModel> {
    try {
      if (/\.kpdf$/i.test(file.name)) return await importProject(file.bytes);
      return await importPdf(file, progress);
    } catch (e) {
      if ((e as { name?: string }).name !== "PasswordException") throw e;
      if (!isTauri())
        throw Error("暗号化PDFはデスクトップ版から開いてください。");
      const result = await ask({
        title: "PDFのパスワード",
        fields: [
          { key: "password", label: "開くためのパスワード", type: "password" },
        ],
        confirm: "開く",
      });
      if (!result) throw new DOMException("キャンセル", "AbortError");
      let bytes: Uint8Array;
      try {
        bytes = await transformPdf("decrypt", file.bytes, result.password);
      } finally {
        result.password = "";
      }
      const model = await importPdf(
        { ...file, bytes },
        progress,
      );
      model.path = undefined;
      setStatus(
        "復号して開きました。保存時の暗号化はパスワード機能で設定してください。",
      );
      return model;
    }
  }
  async function openFiles(files?: LocalFile[], merge = false) {
    if (!merge && !(await mayDiscard())) return;
    const picked = files ?? (await pickFiles("pdf", merge));
    if (!picked.length) return;
    await work("PDFを読み込み中", async () => {
      for (let i = 0; i < picked.length; i++) {
        const model = await decode(picked[i]);
        if (merge || i > 0) documentStore.execute(mergeDocuments(model));
        else {
          await clearRecovery();
          await releasePdfs();
          documentStore.load(model, /\.kpdf$/i.test(picked[i].name));
          setActive(model.pages[0].id);
          setSelected(null);
        }
      }
      setRecent(await recentPaths());
      setStatus("PDFを開きました");
    });
  }
  async function save(as = false) {
    const h = documentStore.history;
    if (!h) return false;
    const snapshot = h.current;
    if (
      snapshot.document.pages.some((p) =>
        p.objects.some((o) => o.kind === "redaction"),
      )
    ) {
      report(
        "墨消し候補が残っています。「墨消しを適用」するか候補を削除してから保存してください。",
      );
      return false;
    }
    let saved = false;
    await work("PDFを保存中", async (signal) => {
      const bytes = await exportDocument(snapshot.document, progress, signal);
      const result = await saveBytes(
        bytes,
        snapshot.document.name,
        as ? undefined : snapshot.document.path,
      );
      if (result) {
        documentStore.saved(snapshot.token, result.name, result.path);
        if (!documentStore.history?.dirty) await clearRecovery();
        setRecent(await recentPaths());
        setStatus("保存しました");
        saved = true;
      }
    });
    return saved;
  }
  return { openFiles, save, mayDiscard };
}
