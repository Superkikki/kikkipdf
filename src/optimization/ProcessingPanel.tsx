import { useEffect, useRef, useState } from "react";
import type { DocumentModel } from "../state/model";
import { pickFiles, saveBytes, type LocalFile } from "../platform/files";
import { exportDocument, exportZip, optimizePdf } from "../export/client";
import type { ProcessingOptions, OptimizationResult } from "./engine";
import { processBatch, validateBatch, type BatchRow } from "./batch";
const size = (n: number) => `${(n / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB`;
export function ProcessingPanel({ model: liveModel, batch }: { model?: DocumentModel; batch: boolean }) {
  const [model] = useState(liveModel);
  const stale = !batch && liveModel !== model;
  const [files, setFiles] = useState<LocalFile[]>([]), [options, setOptions] = useState<ProcessingOptions>({ compression: "balanced", rotation: 0, clearMetadata: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState(""), [progress, setProgress] = useState(0);
  const [result, setResult] = useState<OptimizationResult | null>(null), [rows, setRows] = useState<BatchRow[]>([]), [archive, setArchive] = useState<Uint8Array | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function reset() { setResult(null); setRows([]); setArchive(null); setError(""); setStatus(""); }
  async function select() {
    setError(""); setBusy(true);
    try { const selected = await pickFiles("batchPdf", true); if (selected.length) { validateBatch(selected); reset(); setFiles(selected); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : "ファイルを選択できません。"); }
    finally { setBusy(false); }
  }
  async function run() {
    if (stale) return;
    reset(); setBusy(true); setProgress(0);
    const control = new AbortController(); controller.current = control;
    try {
      if (batch) {
        const processed = await processBatch(files, options, (bytes, settings) => optimizePdf(bytes, settings, undefined, control.signal), control.signal,
          (row, count) => { setRows(previous => [...previous, row]); setProgress(count / files.length * 0.9); });
        if (processed.rows.some(row => row.output)) setArchive(await exportZip(processed.files, control.signal));
        setStatus(`${processed.rows.filter(row => row.output).length}件成功 / ${processed.rows.filter(row => row.error).length}件失敗。失敗したPDFはZIPに含めません。`);
      } else if (model) {
        if (model.pages.some(page => page.objects.some(object => object.kind === "redaction"))) throw Error("先に墨消し候補を適用するか削除してください。");
        for (const source of Object.values(model.sources)) await optimizePdf(source.bytes, { compression: "none", rotation: 0, clearMetadata: false }, undefined, control.signal);
        const bytes = await exportDocument(model, n => setProgress(n * 0.4), control.signal);
        setResult(await optimizePdf(bytes, options, n => setProgress(0.4 + n * 0.6), control.signal));
      }
      setProgress(1);
    } catch (reason) { setArchive(null); setResult(null); setError(control.signal.aborted ? "キャンセルしました。処理結果は保存していません。" : reason instanceof Error ? reason.message : "処理できませんでした。"); }
    finally { controller.current = null; setBusy(false); }
  }
  async function save() {
    if (stale) return;
    setBusy(true); setError("");
    try {
      const saved = archive ? await saveBytes(archive, "processed-pdfs.zip") : result ? await saveBytes(result.bytes, `${model?.name.replace(/\.(pdf|kpdf)$/i, "") ?? "document"}-optimized.pdf`) : null;
      if (saved) setStatus("保存しました。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存できませんでした。"); }
    finally { setBusy(false); }
  }
  return <>
    <div className="dialog-body processing-panel">
      <p className="hint">{batch ? "元ファイルと編集中の文書は変更せず、各PDFの処理結果とreport.jsonをZIPへ保存します。50件、1件32MB、合計256MBまで。" : "現在の編集内容から別のPDFを作成します。通常保存したPDFのサイズと比較し、大きくなる場合は通常保存のデータを採用します。"}</p>
      {batch && <><button data-autofocus disabled={busy} onClick={() => void select()}>処理するPDFを選択</button><p>{files.length}ファイル / {size(files.reduce((sum, file) => sum + file.bytes.length, 0))}</p>
        <ul className="batch-file-list">{files.map((file, i) => <li key={i}>{file.name} ({size(file.bytes.length)}) <button disabled={busy} aria-label={`${i + 1}番目のPDFを除外`} onClick={() => { reset(); setFiles(files.filter((_, index) => index !== i)); }}>除外</button></li>)}</ul></>}
      <label>圧縮方法<select data-autofocus={!batch || undefined} aria-label="圧縮方法" disabled={busy} value={options.compression} onChange={event => { reset(); setOptions({ ...options, compression: event.target.value as ProcessingOptions["compression"] }); }}>
        {batch && <option value="none">圧縮しない</option>}<option value="lossless">画質を維持（構造・非圧縮ストリームを最適化）</option><option value="balanced">バランス（JPEG品質82%、画像の長辺2000pxまで）</option><option value="small">小さくする（JPEG品質65%、画像の長辺1200pxまで）</option>
      </select></label>
      <p className="hint">文字・図形・フォームは画像化しません。画質を変更する設定は8bit RGB・グレーの対応画像に適用します。透明画像・CMYK・特殊な色変換・予測フィルター付き画像などは保持します。効果はPDFにより異なります。署名欄・電子署名付きPDFは処理できません。</p>
      {batch && <><label>全ページの回転<select aria-label="全ページの回転" disabled={busy} value={options.rotation} onChange={event => { reset(); setOptions({ ...options, rotation: Number(event.target.value) }); }}>
        <option value={0}>変更しない</option><option value={90}>右へ90°</option><option value={180}>180°</option><option value={270}>左へ90°</option></select></label>
        <label className="check"><input type="checkbox" disabled={busy} checked={options.clearMetadata} onChange={event => { reset(); setOptions({ ...options, clearMetadata: event.target.checked }); }} />文書情報（Info・文書レベルXMP）を削除</label><p className="hint">注釈・添付・ページ内の個人情報は削除しません。暗号化PDFは先に復号してください。</p></>}
      {busy && <progress aria-label="PDF処理の進捗" value={progress} max={1} />}
      {result && <p role="status">{size(result.before)} → {size(result.after)}（{((1 - result.after / result.before) * 100).toFixed(1)}%削減）<br />画像の再圧縮: {result.images}件 / 保持: {result.skippedImages}件 / ストリーム圧縮: {result.streams}件</p>}
      {!!rows.length && <table aria-label="一括処理の結果"><thead><tr><th>入力PDF</th><th>結果</th></tr></thead><tbody>{rows.map((row, i) => <tr key={i}><td>{row.input}</td><td>{row.error || `${size(row.before)} → ${size(row.after!)}`}</td></tr>)}</tbody></table>}
      {stale && <p role="alert" className="warning">文書が変更されました。画面を開き直してください。</p>}
      {error && <p role="alert" className="warning">{error}</p>}{status && <p role="status">{status}</p>}
    </div>
    <footer>{busy ? <button disabled={!controller.current} onClick={() => controller.current?.abort()}>処理をキャンセル</button> : <button disabled={stale || (batch && !files.length)} onClick={() => void run()}>{batch ? "一括処理を実行" : "圧縮結果を作成"}</button>}
      <button className="primary" disabled={busy || stale || (!result && !archive)} onClick={() => void save()}>{batch ? "結果をZIP保存" : "圧縮PDFを保存"}</button></footer>
  </>;
}
