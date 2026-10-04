import { printPages } from "../export/print";
import { blankPage, emptyDocument, newObject, type DocumentModel, type PageModel } from "../state/model";
import { documentStore } from "../state/store";
import { change, deletePages, duplicatePage, insertBlank, rotatePage } from "../commands/document";
import { clearRecovery, getPreference } from "../state/recovery";
import { isTauri, pickFiles, saveBytes } from "../platform/files";
import { transformPdf } from "../platform/pdfSecurity";
import { importPdf } from "../viewer/pdf";
import { exportProject, exportDocument, createImagePdf, exportSplitZip } from "../export/client";
import { exportPageImages, exportText } from "../export/batch";
import { rasterPage } from "../export/raster";
import { recognize } from "../ocr/engine";
import { applyRedactions } from "../redaction/engine";
import { parseRange } from "../pages/ranges";
import { batchPageCommand, batchPageLabels, type BatchPageOperation } from "../pages/batchOperations";
import type { Action } from "../components/Toolbar";
import type { useDocumentIO } from "./useDocumentIO";
import type { Ask, Work, Progress, WorkspaceModal } from "./types";

interface WorkspaceActionsOptions extends ReturnType<typeof useDocumentIO> {
  doc: DocumentModel | null;
  page: PageModel | undefined;
  ask: Ask;
  work: Work;
  progress: Progress;
  addImage: (bytes?: Uint8Array, mime?: "image/png" | "image/jpeg") => Promise<void>;
  report: (error: string) => void;
  setError: (error: string) => void;
  setStatus: (status: string) => void;
  setActive: (id: string) => void;
  setSelected: (id: string | null) => void;
  setModal: (modal: WorkspaceModal) => void;
}
export function useWorkspaceActions(options: WorkspaceActionsOptions) {
  const { doc, page, ask, work, progress, addImage, report, setError, setStatus,
    setActive, setSelected, setModal, openFiles, save, mayDiscard } = options;
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
          "compare",
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
        case "compare":
          setModal("compare");
          return;
        case "pageLabels":
          setModal("pageLabels");
          return;
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
              let encrypted: Uint8Array;
              try {
                encrypted = await transformPdf("encrypt", bytes, r.password);
              } finally {
                r.password = r.confirm = "";
              }
              await saveBytes(
                encrypted,
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
                  o.wrap = false;
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
  return dispatch;
}
