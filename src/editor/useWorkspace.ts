import { printPages } from "../export/print";
import { pasteObject, type ObjectClipboard } from "./objectActions";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { APP_NAME } from "../config";
import {
  blankPage,
  emptyDocument,
  newObject,
  uid,
  type DocumentModel,
  type ImageAsset,
} from "../state/model";
import { documentStore, useDocument } from "../state/store";
import {
  change,
  updateObject,
  deleteObject,
  deletePages,
  duplicatePage,
  insertBlank,
  mergeDocuments,
  rotatePage,
} from "../commands/document";
import {
  clearRecovery,
  loadRecovery,
  saveRecovery,
  getPreference,
  setPreference,
} from "../state/recovery";
import {
  isTauri,
  pickFiles,
  readPath,
  recentPaths,
  saveBytes,
  type LocalFile,
} from "../platform/files";
import { importPdf, releasePdfs } from "../viewer/pdf";
import {
  exportProject,
  importProject,
  exportDocument,
  createImagePdf,
  exportSplitZip,
} from "../export/client";
import { exportPageImages, exportText } from "../export/batch";
import { rasterPage } from "../export/raster";
import { recognize } from "../ocr/engine";
import { applyRedactions } from "../redaction/engine";
import { parseRange } from "../pages/ranges";
import {
  batchPageCommand,
  batchPageLabels,
  type BatchPageOperation,
} from "../pages/batchOperations";
import { usePrompt } from "../components/Prompt";
import type { Action } from "../components/Toolbar";
import type { Tool } from "../viewer/PageView";
import type { ZoomMode } from "../viewer/Viewer";
export function useWorkspace() {
  const clipboard = useRef<ObjectClipboard | null>(null);
  const state = useDocument();
  const { document: doc } = state;
  const [active, setActive] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [tool, setTool] = useState<Tool>("select"),
    [zoom, setZoom] = useState<ZoomMode>("width"),
    [category, setCategory] = useState("編集");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") ?? "light",
  );
  const [error, setError] = useState(""),
    [status, setStatus] = useState("準備完了"),
    [busy, setBusy] = useState<{ label: string; progress: number } | null>(
      null,
    ),
    [modal, setModal] = useState<"forms" | "signature" | "links" | null>(null),
    [recent, setRecent] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null),
    busyRef = useRef(false);
  const { ask, dialog } = usePrompt();
  const init = useRef(false);
  const report = useCallback((s: string) => setError(s), []);
  const page = doc?.pages.find((p) => p.id === active) ?? doc?.pages[0];
  useEffect(() => {
    window.document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  useEffect(() => {
    if (page && page.id !== active) setActive(page.id);
  }, [page, active]);
  const jump = useCallback((id: string) => {
    setActive(id);
    setSelected(null);
    window.document
      .getElementById(`page-${id}`)
      ?.scrollIntoView({ behavior: "instant", block: "start" });
  }, []);
  function progress(value: number, label?: string) {
    setBusy((prev) =>
      prev ? { label: label ?? prev.label, progress: value } : null,
    );
  }
  async function work(
    label: string,
    job: (signal: AbortSignal) => Promise<void>,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    const c = new AbortController();
    controller.current = c;
    setBusy({ label, progress: 0 });
    setStatus(label);
    setError("");
    try {
      await job(c.signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError")
        setStatus("キャンセルしました");
      else report(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      controller.current = null;
      setBusy(null);
    }
  }
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
      const bytes = await invoke<ArrayBuffer>("decrypt_pdf", {
        bytes: Array.from(file.bytes),
        password: result.password,
      });
      result.password = "";
      const model = await importPdf(
        { ...file, bytes: new Uint8Array(bytes) },
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
  async function addImage(
    bytes?: Uint8Array,
    mime: "image/png" | "image/jpeg" = "image/png",
  ) {
    const p = page;
    if (!p) return;
    const file = bytes
      ? { bytes, name: "signature.png" }
      : (await pickFiles("image"))[0];
    if (!file) return;
    if (!bytes) mime = /\.jpe?g$/i.test(file.name) ? "image/jpeg" : "image/png";
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(file.bytes)], { type: mime }),
    );
    const width = Math.min(240, p.width - 64),
      height = (width * bitmap.height) / bitmap.width;
    bitmap.close();
    const asset: ImageAsset = { id: uid(), bytes: file.bytes, mime };
    const o = {
      ...newObject("image", 32, 32),
      width,
      height,
      imageId: asset.id,
    };
    documentStore.execute(
      change("画像追加", (d) => ({
        ...d,
        images: { ...d.images, [asset.id]: asset },
        pages: d.pages.map((pg) =>
          pg.id === p.id ? { ...pg, objects: [...pg.objects, o] } : pg,
        ),
      })),
    );
    setSelected(o.id);
    setTool("select");
    setCategory("編集");
  }
  async function range(title: string) {
    if (!doc) return null;
    const result = await ask({
      title,
      fields: [
        { key: "range", label: "ページ範囲（空欄は全ページ）", value: "" },
      ],
    });
    return result ? parseRange(result.range, doc.pages.length) : null;
  }
  async function dispatch(a: Action) {
    setError("");
    try {
      if (a === "open") {
        await openFiles();
        return;
      }
      if (a === "projectOpen") {
        const files = await pickFiles("project");
        if (files.length) await openFiles(files);
        return;
      }
      if (a === "new") {
        if (await mayDiscard()) {
          const d = emptyDocument();
          d.pages = [blankPage()];
          documentStore.load(d, true);
          setActive(d.pages[0].id);
          setSelected(null);
          await clearRecovery();
        }
        return;
      }
      if (a === "imagesPdf") {
        if (!(await mayDiscard())) return;
        const files = await pickFiles("image", true);
        if (!files.length) return;
        await work("画像からPDFを作成中", async () => {
          const images = [];
          for (const f of files) {
            const mime = /\.jpe?g$/i.test(f.name) ? "image/jpeg" : "image/png";
            const bitmap = await createImageBitmap(
              new Blob([new Uint8Array(f.bytes)], { type: mime }),
            );
            images.push({
              bytes: f.bytes,
              width: bitmap.width * 0.75,
              height: bitmap.height * 0.75,
              mime,
            });
            bitmap.close();
          }
          const model = await importPdf({
            name: "画像から作成.pdf",
            bytes: await createImagePdf(images),
          });
          documentStore.load(model, true);
          setActive(model.pages[0].id);
        });
        return;
      }
      if (!doc || !page) return;
      if (
        [
          "print",
          "batchImages",
          "textExport",
          "extract",
          "split",
          "splitZip",
          "png",
          "jpeg",
          "encrypt",
        ].includes(a) &&
        doc.pages.some((p) => p.objects.some((o) => o.kind === "redaction"))
      ) {
        throw Error(
          "墨消し候補が残っています。先に墨消しを適用するか、候補を削除してください。",
        );
      }
      switch (a) {
        case "pageBatch": {
          const r = await ask({
            title: "ページを一括操作",
            message:
              "指定範囲へまとめて適用します。操作全体を一度のUndoで戻せます。",
            fields: [
              {
                key: "range",
                label: "ページ範囲（空欄は全ページ）",
                value: String(doc.pages.findIndex((p) => p.id === page.id) + 1),
              },
              {
                key: "operation",
                label: "操作",
                value: batchPageLabels.rotateRight,
                options: Object.values(batchPageLabels),
              },
            ],
          });
          if (r) {
            const operation = (Object.entries(batchPageLabels).find(
              ([, label]) => label === r.operation,
            )?.[0] ?? "rotateRight") as BatchPageOperation;
            documentStore.execute(
              batchPageCommand(
                parseRange(r.range, doc.pages.length).map(
                  (i) => doc.pages[i].id,
                ),
                operation,
              ),
            );
            setStatus("ページを一括編集しました");
          }
          break;
        }
        case "splitZip": {
          const r = await ask({
            title: "分割してZIPに保存",
            message:
              "指定範囲を入力した順で分割し、part-0001.pdfから順番に格納します。添付ファイルは含めません。",
            fields: [
              { key: "range", label: "ページ範囲（空欄は全ページ）" },
              {
                key: "groupSize",
                label: "1ファイルあたりのページ数",
                type: "number",
                value: "1",
              },
            ],
          });
          if (r)
            await work("PDFを分割してZIPを作成中", async (signal) => {
              const bytes = await exportSplitZip(
                doc,
                parseRange(r.range, doc.pages.length),
                Number(r.groupSize),
                progress,
                signal,
              );
              if (
                await saveBytes(
                  bytes,
                  doc.name.replace(/\.pdf$/i, "") + "-分割.zip",
                )
              )
                setStatus("分割PDFをZIPに保存しました");
            });
          break;
        }
        case "links":
          setModal("links");
          break;
        case "print": {
          const result = await ask({
            title: "印刷",
            message:
              "指定ページを印刷用画像にしてWindowsの印刷ダイアログを開きます。用紙・両面・部数は次の画面で設定してください。",
            confirm: "印刷画面を開く",
            fields: [
              {
                key: "range",
                label: "ページ範囲（空欄は全ページ）",
                value: String(doc.pages.findIndex((p) => p.id === page.id) + 1),
              },
              {
                key: "dpi",
                label: "印刷解像度",
                value: "144",
                options: ["72", "144", "200", "300"],
              },
            ],
          });
          if (result)
            await work("印刷を準備中", async (signal) => {
              await printPages(
                doc,
                parseRange(result.range, doc.pages.length),
                Number(result.dpi),
                progress,
                signal,
              );
              setStatus("印刷画面を開きました");
            });
          break;
        }
        case "batchImages": {
          const result = await ask({
            title: "ページを一括画像出力",
            message:
              "ページを1枚ずつ画像化してZIPにまとめます。巨大なページは最大2000万画素に制限されます。",
            fields: [
              { key: "range", label: "ページ範囲（空欄は全ページ）" },
              {
                key: "format",
                label: "画像形式",
                value: "png",
                options: ["png", "jpeg"],
              },
              {
                key: "dpi",
                label: "解像度（dpi）",
                value: "144",
                options: ["72", "144", "200", "300"],
              },
              {
                key: "quality",
                label: "JPEG品質（1〜100）",
                type: "number",
                value: "90",
              },
            ],
          });
          if (result)
            await work("画像出力を準備中", async (signal) => {
              const indices = parseRange(result.range, doc.pages.length);
              const bytes = await exportPageImages(
                doc,
                indices,
                result.format as "png" | "jpeg",
                Number(result.dpi),
                Math.max(1, Math.min(100, Number(result.quality))) / 100,
                progress,
                signal,
              );
              if (
                await saveBytes(
                  bytes,
                  doc.name.replace(/\.pdf$/i, "") + "-images.zip",
                )
              )
                setStatus("ページ画像をZIPに保存しました");
            });
          break;
        }
        case "textExport": {
          const result = await ask({
            title: "テキストを抽出",
            message:
              "UTF-8テキストとして保存します。段組みの順序やOCRの誤認識は自動補正しません。見た目で置換した元の文字も抽出され得ます。",
            fields: [{ key: "range", label: "ページ範囲（空欄は全ページ）" }],
          });
          if (result)
            await work("テキストを抽出中", async (signal) => {
              const bytes = await exportText(
                doc,
                parseRange(result.range, doc.pages.length),
                progress,
                signal,
              );
              if (
                await saveBytes(bytes, doc.name.replace(/\.pdf$/i, "") + ".txt")
              )
                setStatus("テキストを保存しました");
            });
          break;
        }
        case "projectSave":
          await work("編集プロジェクトを保存中", async (signal) => {
            const result = await saveBytes(
              await exportProject(doc, signal),
              doc.name.replace(/\.pdf$/i, "") + ".kpdf",
            );
            if (result)
              setStatus(
                "編集プロジェクトを保存しました（元PDFを含む・暗号化なし）。PDFは別途保存してください。",
              );
          });
          break;
        case "save":
          await save();
          break;
        case "saveAs":
          await save(true);
          break;
        case "undo":
          documentStore.undo();
          break;
        case "redo":
          documentStore.redo();
          break;
        case "rotate":
          documentStore.execute(rotatePage(page.id));
          break;
        case "duplicate":
          documentStore.execute(duplicatePage(page.id));
          break;
        case "delete": {
          const r = await ask({
            title: "ページを削除",
            message: "削除後もUndoで元に戻せます。",
            fields: [
              {
                key: "range",
                label: "削除するページ範囲",
                value: String(doc.pages.indexOf(page) + 1),
              },
            ],
            confirm: "削除",
            danger: true,
          });
          if (r)
            documentStore.execute(
              deletePages(
                parseRange(r.range, doc.pages.length).map(
                  (i) => doc.pages[i].id,
                ),
              ),
            );
          break;
        }
        case "blank":
          documentStore.execute(insertBlank(page.id));
          break;
        case "merge":
          await openFiles(undefined, true);
          break;
        case "image":
          await addImage();
          break;
        case "extract": {
          const indices = await range("ページを抽出");
          if (indices)
            await work("ページを抽出中", async (signal) => {
              await saveBytes(
                await exportDocument(doc, progress, signal, indices),
                doc.name.replace(/\.pdf$/i, "") + "-抽出.pdf",
              );
            });
          break;
        }
        case "split": {
          const indices = await range("1ページずつ分割");
          if (indices)
            await work("PDFを分割中", async (signal) => {
              for (let n = 0; n < indices.length; n++) {
                if (signal.aborted)
                  throw new DOMException("キャンセル", "AbortError");
                const i = indices[n];
                const saved = await saveBytes(
                  await exportDocument(doc, undefined, signal, [i]),
                  doc.name.replace(/\.pdf$/i, "") + `-${i + 1}.pdf`,
                );
                if (!saved) break;
                progress((n + 1) / indices.length);
              }
            });
          break;
        }
        case "crop": {
          const r = await ask({
            title: "ページのトリミング",
            message:
              "指定した余白を非表示にします。情報そのものの削除ではありません。単位はpt。",
            fields: [
              { key: "left", label: "左", type: "number", value: "24" },
              { key: "top", label: "上", type: "number", value: "24" },
              { key: "right", label: "右", type: "number", value: "24" },
              { key: "bottom", label: "下", type: "number", value: "24" },
            ],
          });
          if (r) {
            const left = Number(r.left),
              top = Number(r.top),
              width = page.width - left - Number(r.right),
              height = page.height - top - Number(r.bottom);
            if (
              [left, top, Number(r.right), Number(r.bottom)].some(
                (n) => !Number.isFinite(n) || n < 0,
              ) ||
              width < 1 ||
              height < 1
            )
              throw Error("余白がページサイズを超えています。");
            documentStore.execute(
              change("トリミング", (d) => ({
                ...d,
                pages: d.pages.map((p) =>
                  p.id === page.id
                    ? { ...p, crop: { x: left, y: top, width, height } }
                    : p,
                ),
              })),
            );
          }
          break;
        }
        case "forms":
          setModal("forms");
          break;
        case "signature":
          setModal("signature");
          break;
        case "savedSignature": {
          const bytes = await getPreference<Uint8Array>("signature");
          if (bytes) await addImage(bytes);
          else setModal("signature");
          break;
        }
        case "ocr": {
          const r = await ask({
            title: "ローカルOCR",
            message:
              "日英の言語データは同梱済みです。認識結果は透明テキストとして保存されます。誤認識があり得るため検索結果を確認してください。",
            fields: [
              { key: "range", label: "ページ範囲（空欄は全ページ）" },
              {
                key: "language",
                label: "言語",
                value: "jpn+eng",
                options: ["jpn+eng", "jpn", "eng"],
              },
            ],
          });
          if (r) {
            const indices = parseRange(r.range, doc.pages.length);
            await work("OCRを準備中", async (signal) => {
              const results = await recognize(
                doc,
                indices,
                r.language,
                progress,
                signal,
              );
              documentStore.execute(
                change("OCR", (d) => ({
                  ...d,
                  pages: d.pages.map((p) =>
                    results.has(p.id)
                      ? {
                          ...p,
                          objects: [
                            ...p.objects.filter((o) => o.kind !== "ocr"),
                            ...results.get(p.id)!,
                          ],
                        }
                      : p,
                  ),
                })),
              );
              setStatus("OCR完了。保存すると検索可能なPDFになります。");
            });
          }
          break;
        }
        case "redact": {
          if (
            !doc.pages.some((p) =>
              p.objects.some((o) => o.kind === "redaction"),
            )
          )
            throw Error("先に「墨消し候補」で削除する領域を指定してください。");
          const r = await ask({
            title: "墨消しを適用",
            danger: true,
            message:
              "全ページを画像化して新しいPDFを生成し、指定領域の画素を黒く置換します。元のテキスト・画像オブジェクト・添付・メタデータは出力へコピーしません。検索、フォーム、リンク、ベクター品質は失われます。領域外に同じ情報がないか確認してください。元ファイルと復旧データはこの操作だけでは消去されません。",
            confirm: "新しいPDFへ墨消しを適用",
          });
          if (r)
            await work("墨消しを適用中", async (signal) => {
              const bytes = await applyRedactions(doc, progress, signal);
              const result = await saveBytes(
                bytes,
                doc.name.replace(/\.pdf$/i, "") + "-墨消し.pdf",
              );
              if (result)
                setStatus(
                  "墨消しPDFを別ファイルに保存しました。内容を開いて確認してください。",
                );
            });
          break;
        }
        case "encrypt": {
          if (!isTauri())
            throw Error("パスワード設定はデスクトップ版で利用できます。");
          const r = await ask({
            title: "パスワード付きPDFを保存",
            fields: [
              {
                key: "password",
                label: "パスワード（8文字以上）",
                type: "password",
              },
              { key: "confirm", label: "パスワードを再入力", type: "password" },
            ],
            message:
              "AES-256で新しいPDFを保存します。編集中の復旧データは暗号化されません。",
          });
          if (r) {
            if (r.password !== r.confirm || r.password.length < 8)
              throw Error("8文字以上の同じパスワードを入力してください。");
            await work("PDFを暗号化中", async (signal) => {
              const bytes = await exportDocument(doc, progress, signal);
              const encrypted = await invoke<ArrayBuffer>("encrypt_pdf", {
                bytes: Array.from(bytes),
                password: r.password,
              });
              r.password = r.confirm = "";
              await saveBytes(
                new Uint8Array(encrypted),
                doc.name.replace(/\.pdf$/i, "") + "-保護.pdf",
              );
            });
          }
          break;
        }
        case "png":
        case "jpeg":
          await work("ページを画像へ変換中", async (signal) => {
            const bytes = await rasterPage(
              doc,
              doc.pages.indexOf(page),
              a,
              signal,
            );
            await saveBytes(
              bytes,
              `${doc.name.replace(/\.pdf$/i, "")}-${doc.pages.indexOf(page) + 1}.${a}`,
            );
          });
          break;
        case "metadata": {
          const bytes = Object.values(doc.sources).reduce(
            (n, s) => n + s.bytes.length,
            0,
          );
          const source = Object.values(doc.sources)[0];
          const version = source
            ? new TextDecoder()
                .decode(source.bytes.subarray(0, 12))
                .match(/%PDF-([\d.]+)/)?.[1]
            : "1.7";
          const r = await ask({
            title: "文書のプロパティ",
            message: `${doc.pages.length} ページ / ${Math.round(page.width)} × ${Math.round(page.height)} pt / 元ファイル ${(bytes / 1024 / 1024).toFixed(2)} MB / PDF ${version ?? "—"}`,
            fields: [
              { key: "title", label: "タイトル", value: doc.metadata.title },
              { key: "author", label: "作成者", value: doc.metadata.author },
              { key: "subject", label: "件名", value: doc.metadata.subject },
              {
                key: "keywords",
                label: "キーワード",
                value: doc.metadata.keywords,
              },
            ],
          });
          if (r)
            documentStore.execute(
              change("文書情報", (d) => ({
                ...d,
                metadata: {
                  title: r.title,
                  author: r.author,
                  subject: r.subject,
                  keywords: r.keywords,
                },
              })),
            );
          break;
        }
        case "decorate": {
          const r = await ask({
            title: "ページ番号・ヘッダー・透かし",
            fields: [
              {
                key: "kind",
                label: "種類",
                value: "フッター",
                options: [
                  "ページ番号",
                  "ヘッダー",
                  "フッター",
                  "透かし",
                  "背景",
                ],
              },
              {
                key: "text",
                label: "テキスト（{page} / {total} を使用可）",
                value: "{page} / {total}",
              },
              { key: "range", label: "ページ範囲（空欄は全ページ）" },
              { key: "color", label: "色", type: "color", value: "#708090" },
            ],
          });
          if (r) {
            const indices = parseRange(r.range, doc.pages.length);
            documentStore.execute(
              change("ページ装飾", (d) => ({
                ...d,
                pages: d.pages.map((p, i) => {
                  if (!indices.includes(i)) return p;
                  const o = newObject(
                    r.kind === "背景" ? "rect" : "text",
                    32,
                    r.kind === "ヘッダー"
                      ? 20
                      : r.kind === "透かし"
                        ? p.height / 2
                        : p.height - 36,
                  );
                  o.text = r.text
                    .replaceAll("{page}", String(i + 1))
                    .replaceAll("{total}", String(d.pages.length));
                  o.color = r.color;
                  o.width = p.width - 64;
                  o.height = 24;
                  o.fontSize = r.kind === "透かし" ? 44 : 11;
                  o.align = "center";
                  if (r.kind === "透かし") o.opacity = 0.2;
                  if (r.kind === "背景") {
                    o.x = 0;
                    o.y = 0;
                    o.width = p.width;
                    o.height = p.height;
                    o.fill = r.color;
                    o.opacity = 0.15;
                    o.strokeWidth = 0;
                  }
                  return {
                    ...p,
                    objects:
                      r.kind === "背景" ? [o, ...p.objects] : [...p.objects, o],
                  };
                }),
              })),
            );
          }
          break;
        }
      }
    } catch (e) {
      report(e instanceof Error ? e.message : String(e));
    }
  }
  const action = (a: Action) => {
    if (!busyRef.current) void dispatch(a);
  };
  const latest = useRef({
    openFiles,
    save,
    mayDiscard,
    dispatch,
    selected,
    page,
  });
  latest.current = { openFiles, save, mayDiscard, dispatch, selected, page };
  useEffect(() => {
    if (init.current) return;
    init.current = true;
    void recentPaths()
      .then(setRecent)
      .catch(() => {});
    void loadRecovery()
      .then(async (recovery) => {
        if (recovery) {
          const r = await ask({
            title: "前回の編集を復元",
            message: `${recovery.document.name} の未保存データがあります（${new Date(recovery.time).toLocaleString()}）。`,
            confirm: "復元",
          });
          if (r) {
            documentStore.load(recovery.document, true);
            setActive(recovery.document.pages[0].id);
            return;
          } else await clearRecovery();
        }
        if (isTauri()) {
          const paths = await invoke<string[]>("startup_documents");
          if (paths.length)
            await latest.current.openFiles(
              await Promise.all(paths.map(readPath)),
            );
        }
      })
      .catch(() => report("復旧データを読み込めませんでした。"));
  }, [ask, report]);
  useEffect(() => {
    const timer = setInterval(() => {
      const h = documentStore.history;
      if (h?.dirty)
        void saveRecovery(h.current.document).catch(() =>
          report(
            "自動復旧データを保存できません。空き容量を確認してください。",
          ),
        );
    }, 15000);
    return () => clearInterval(timer);
  }, [report]);
  useEffect(() => {
    const title = `${state.dirty ? "● " : ""}${doc ? doc.name + " — " : ""}${APP_NAME}`;
    window.document.title = title;
    if (isTauri())
      void getCurrentWindow()
        .setTitle(title)
        .catch(() => {});
  }, [doc, state.dirty]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const input =
        e.target instanceof HTMLElement &&
        !!e.target.closest("input,textarea,select,[contenteditable]");
      if (window.document.querySelector("dialog[open]")) return;
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (!input && !busyRef.current && ["c", "x", "v", "d"].includes(k)) {
          const p = latest.current.page,
            current = p?.objects.find((o) => o.id === latest.current.selected);
          if (k === "v" && p && clipboard.current) {
            e.preventDefault();
            const pasted = pasteObject(p.id, clipboard.current);
            documentStore.execute(pasted.command);
            setSelected(pasted.id);
            setTool("select");
            return;
          }
          if (
            current &&
            p &&
            !window.getSelection()?.toString() &&
            ["c", "x", "d"].includes(k)
          ) {
            e.preventDefault();
            const data = {
              object: current,
              image: current.imageId
                ? documentStore.document?.images[current.imageId]
                : undefined,
            };
            if (k === "d") {
              const pasted = pasteObject(p.id, data);
              documentStore.execute(pasted.command);
              setSelected(pasted.id);
            } else {
              clipboard.current = data;
              setStatus("オブジェクトをコピーしました");
              if (k === "x") {
                documentStore.execute(deleteObject(p.id, current.id));
                setSelected(null);
              }
            }
            return;
          }
        }
        if (["o", "s", "z", "y", "p"].includes(k)) {
          if (input && (k === "z" || k === "y")) return;
          e.preventDefault();
          if (busyRef.current) return;
          if (k === "p") void latest.current.dispatch("print");
          if (k === "o") void latest.current.openFiles();
          if (k === "s") void latest.current.save(e.shiftKey);
          if (k === "z") {
            if (e.shiftKey) documentStore.redo();
            else documentStore.undo();
          }
          if (k === "y") documentStore.redo();
        }
      } else if (
        !input &&
        !busyRef.current &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
        latest.current.selected &&
        latest.current.page
      ) {
        const p = latest.current.page,
          object = p.objects.find((o) => o.id === latest.current.selected);
        if (object) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1,
            x =
              e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0,
            y = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0,
            r = (p.rotation * Math.PI) / 180;
          documentStore.execute(
            updateObject(p.id, object.id, {
              x: Math.max(
                0,
                object.x + Math.round(Math.cos(r) * x + Math.sin(r) * y),
              ),
              y: Math.max(
                0,
                object.y + Math.round(-Math.sin(r) * x + Math.cos(r) * y),
              ),
            }),
          );
        }
      } else if (
        e.key === "Delete" &&
        !input &&
        latest.current.selected &&
        latest.current.page
      ) {
        documentStore.execute(
          deleteObject(latest.current.page.id, latest.current.selected),
        );
        setSelected(null);
      } else if (e.key === "Escape") {
        setSelected(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (documentStore.history?.dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", before);
    if (!isTauri())
      return () => window.removeEventListener("beforeunload", before);
    let live = true;
    const offClose = getCurrentWindow().onCloseRequested(async (e) => {
      e.preventDefault();
      if (busyRef.current) {
        report("処理を完了するかキャンセルしてから閉じてください。");
        return;
      }
      if (await latest.current.mayDiscard()) {
        await clearRecovery();
        await getCurrentWindow().destroy();
      }
    });
    const offDrop = getCurrentWindow().onDragDropEvent((e) => {
      if (e.payload.type === "drop" && !busyRef.current) {
        const paths = e.payload.paths.filter((p) => /\.(pdf|kpdf)$/i.test(p));
        void Promise.all(paths.map(readPath))
          .then((files) => latest.current.openFiles(files))
          .catch(() => report("ドロップしたPDFを読み込めません。"));
      }
    });
    void offClose.then((off) => {
      if (!live) off();
    });
    void offDrop.then((off) => {
      if (!live) off();
    });
    return () => {
      live = false;
      window.removeEventListener("beforeunload", before);
      void offClose.then((off) => off());
      void offDrop.then((off) => off());
    };
  }, [report]);
  return {
    ...state,
    active,
    page,
    setActive,
    selected,
    setSelected,
    tool,
    setTool,
    zoom,
    setZoom,
    category,
    setCategory,
    theme,
    setTheme,
    error,
    setError,
    status,
    busy,
    modal,
    setModal,
    recent,
    dialog,
    report,
    jump,
    action,
    cancel: () => controller.current?.abort(),
    openFiles,
    openRecent: (path: string) => {
      void readPath(path)
        .then((file) => openFiles([file]))
        .catch(() =>
          report("最近のPDFを開けません。ファイル選択から開き直してください。"),
        );
    },
    signature: async (bytes: Uint8Array) => {
      setModal(null);
      await setPreference("signature", bytes);
      await addImage(bytes);
    },
  };
}
