import { useCallback, useEffect, useRef, useState } from "react";
import { getDocument, type PDFDocumentLoadingTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentModel } from "../state/model";
import { exportDocument } from "../export/client";
import { pickFiles, saveBytes, type LocalFile } from "../platform/files";
import { checkAbort, comparePdfs, renderPair, type ComparedPage } from "./engine";
import { pixelChanged } from "./pixels";

const labels = { same: "変更なし", changed: "変更あり", added: "追加", removed: "削除" };
interface Session { tasks: PDFDocumentLoadingTask[]; threshold: number; dpi: number; leftName: string; rightName: string }
export function ComparisonPanel({ model }: { model: DocumentModel }) {
  const [file, setFile] = useState<LocalFile | null>(null);
  const [threshold, setThreshold] = useState(24), [dpi, setDpi] = useState(72);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<ComparedPage[]>([]), [selected, setSelected] = useState(0);
  const [changedOnly, setChangedOnly] = useState(false), [previewBusy, setPreviewBusy] = useState(false);
  const controller = useRef<AbortController | null>(null), session = useRef<Session | null>(null);
  const previewController = useRef<AbortController | null>(null);
  const canvasLeft = useRef<HTMLCanvasElement>(null), canvasRight = useRef<HTMLCanvasElement>(null), canvasDiff = useRef<HTMLCanvasElement>(null);
  const disposed = useRef(false);
  const release = useCallback(() => {
    controller.current?.abort(); previewController.current?.abort();
    const current = session.current; session.current = null;
    current?.tasks.forEach(task => { void task.destroy().catch(() => {}); });
  }, []);
  useEffect(() => {
    disposed.current = false;
    return () => { disposed.current = true; release(); };
  }, [release]);
  useEffect(() => {
    const current = session.current;
    if (!results.length || !current) return;
    const abort = new AbortController(); previewController.current = abort;
    const canvases = [canvasLeft.current, canvasRight.current, canvasDiff.current];
    canvases.forEach(canvas => { if (canvas) { canvas.width = 0; canvas.height = 0; } });
    setPreviewBusy(true);
    void (async () => {
      const [left, right] = await Promise.all(current.tasks.map(task => task.promise));
      const { result, pixels } = await renderPair(left, right, selected, { ...current, signal: abort.signal });
      checkAbort(abort.signal);
      const difference = new Uint8ClampedArray(pixels[0].length);
      for (let offset = 0; offset < difference.length; offset += 4) {
        const changed = pixelChanged(pixels[0], pixels[1], offset, current.threshold);
        const gray = Math.round((pixels[0][offset] + pixels[0][offset + 1] + pixels[0][offset + 2]) / 3 * .3 + 178);
        difference.set(changed ? [220, 25, 125, 255] : [gray, gray, gray, 255], offset);
      }
      [pixels[0], pixels[1], difference].forEach((data, index) => {
        const canvas = canvases[index]; if (!canvas) return;
        canvas.width = result.width; canvas.height = result.height;
        const context = canvas.getContext("2d")!;
        context.putImageData(new ImageData(new Uint8ClampedArray(data), result.width, result.height), 0, 0);
        if (index === 2) {
          context.strokeStyle = "#a50064"; context.lineWidth = 2;
          result.regions.forEach(region => context.strokeRect(region.x + 1, region.y + 1, Math.max(0, region.width - 2), Math.max(0, region.height - 2)));
        }
      });
    })().catch(reason => { if (!abort.signal.aborted) setError(String(reason instanceof Error ? reason.message : reason)); })
      .finally(() => { if (!abort.signal.aborted) setPreviewBusy(false); });
    return () => { abort.abort(); canvases.forEach(canvas => { if (canvas) { canvas.width = 0; canvas.height = 0; } }); };
  }, [results, selected]);
  const choose = async () => {
    try {
      const picked = (await pickFiles("pdf"))[0];
      if (!picked || disposed.current) return;
      if (!picked.name.toLowerCase().endsWith(".pdf")) throw new Error("比較対象にはPDFファイルを選んでください。");
      release(); setResults([]); setFile(picked); setError(""); setProgress("");
    } catch (reason) { if (!disposed.current) setError(String(reason instanceof Error ? reason.message : reason)); }
  };
  const clearResults = () => {
    release(); setResults([]); setProgress(""); setError("");
  };
  const run = async () => {
    if (!file) return;
    release();
    const abort = new AbortController(); controller.current = abort;
    const current: Session = { tasks: [], threshold, dpi, leftName: model.name, rightName: file.name };
    session.current = current;
    setBusy(true); setResults([]); setError(""); setProgress("編集中の文書を準備しています…");
    try {
      if (model.pages.length > 500) throw new Error("PDF比較は各文書500ページまでです。");
      const bytes = await exportDocument({ ...model, flattenForms: true }, undefined, abort.signal);
      checkAbort(abort.signal);
      // Each comparison owns its PDF.js documents; never detach source bytes from the editor.
      const resources = { cMapUrl: "/assets/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/assets/pdfjs/standard_fonts/", wasmUrl: "/assets/pdfjs/wasm/" };
      current.tasks.push(getDocument({ data: bytes, ...resources }));
      current.tasks.push(getDocument({ data: file.bytes.slice(), ...resources }));
      const [left, right] = await Promise.all(current.tasks.map(task => task.promise));
      checkAbort(abort.signal);
      const pages = await comparePdfs(left, right, { threshold, dpi, signal: abort.signal, onProgress: (done, total) => setProgress(`${done} / ${total} ページを比較中`) });
      checkAbort(abort.signal);
      setSelected(pages.find(page => page.status !== "same")?.index ?? 0);
      setChangedOnly(false); setResults(pages); setProgress("比較完了");
    } catch (reason) {
      if (!abort.signal.aborted) {
        setProgress("");
        setError(reason instanceof Error && reason.name === "PasswordException" ? "パスワードで保護された比較対象は、解除してから選んでください。" : String(reason instanceof Error ? reason.message : reason));
      }
      if (session.current === current) release();
    } finally { if (!disposed.current && controller.current === abort) setBusy(false); }
  };
  const report = async () => {
    const current = session.current; if (!current) return;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify({ format: "kikki-pdf-visual-comparison", version: 1, createdAt: new Date().toISOString(), left: current.leftName, right: current.rightName, threshold: current.threshold, dpi: current.dpi, pageMatching: "position", pageSizeUnits: "pt", regionUnits: "pixels", regionLimit: 200, maxPixels: 2_000_000, maxEdge: 4096, pages: results }, null, 2));
      await saveBytes(bytes, `${current.leftName.replace(/\.pdf$/i, "")}-比較.json`);
    } catch (reason) { if (!disposed.current) setError(String(reason instanceof Error ? reason.message : reason)); }
  };
  const page = results[selected], changed = results.filter(page => page.status !== "same").length;
  return <div className="dialog-body comparison-panel">
    <p>未保存の編集を含む現在の文書と、選んだPDFをページ順で比較します。差分はピンク色で表示します。</p>
    <div className="comparison-controls">
      <button disabled={busy} onClick={() => void choose()}>比較するPDFを選ぶ</button><span>{file?.name ?? "未選択"}</span>
      <label>感度 <select aria-label="感度" value={threshold} disabled={busy} onChange={e => { clearResults(); setThreshold(Number(e.target.value)); }}><option value={8}>高い（8）</option><option value={24}>標準（24）</option><option value={48}>低い（48）</option></select></label>
      <label>比較解像度 <select aria-label="比較解像度" value={dpi} disabled={busy} onChange={e => { clearResults(); setDpi(Number(e.target.value)); }}><option value={72}>72 dpi</option><option value={144}>144 dpi</option></select></label>
      <button className="primary" disabled={!file || busy} onClick={() => void run()}>比較を実行</button>
      {busy && <button onClick={() => { release(); setBusy(false); setProgress("比較を中止しました"); }}>キャンセル</button>}
    </div>
    <p className="comparison-hint">各文書500ページまで。描画は1ページ200万画素・一辺4096画素以内に縮小します。文字の意味・メタデータ・添付ファイルは比較しません。途中のページ挿入は、後続ページの差分としても検出されます。</p>
    <p role="status" aria-live="polite">{progress}{results.length > 0 && `：${results.length}ページ中${changed}ページに変更`}</p>
    {error && <p role="alert" className="comparison-error">{error}</p>}
    {!!results.length && <>
      <div className="comparison-controls"><label><input type="checkbox" checked={changedOnly} onChange={e => { const checked = e.target.checked; setChangedOnly(checked); if (checked && results[selected].status === "same") setSelected(results.find(p => p.status !== "same")?.index ?? selected); }} />変更のあるページだけ表示</label><button onClick={() => void report()}>比較レポートを保存</button></div>
      <div className="comparison-layout">
        <nav aria-label="比較ページ">{results.filter(p => !changedOnly || p.status !== "same").map(p => <button key={p.index} aria-pressed={selected === p.index} onClick={() => setSelected(p.index)}>ページ{p.index + 1} · {labels[p.status]}{p.sizeChanged ? "（サイズ変更）" : ""}</button>)}{changedOnly && !changed && <p>変更はありません。</p>}</nav>
        <div className="comparison-preview">
          <p>ページ{selected + 1}：{labels[page.status]} · 差分 {(page.ratio * 100).toFixed(2)}%{page.sizeChanged ? " · ページサイズ変更" : ""}{previewBusy ? " · 描画中…" : ""}</p>
          <div className="comparison-images">{[
            { label: "編集中の文書", ref: canvasLeft, missing: !page.leftSize },
            { label: "比較対象", ref: canvasRight, missing: !page.rightSize },
            { label: "差分", ref: canvasDiff, missing: false },
          ].map(({ label, ref, missing }) => <figure key={label}><figcaption>{label}{missing ? "（ページなし）" : ""}</figcaption><canvas aria-label={label} ref={ref} /></figure>)}</div>
          <p className="comparison-hint">差分の枠は近接した変更をまとめた領域です。大きい領域から最大200件を表示します。数値・枠の座標は縮小後の画像を基準にしています。</p>
        </div>
      </div>
    </>}
  </div>;
}
