import { useEffect, useRef, useState } from "react";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentModel } from "../state/model";
import type { FormDescriptor } from "../export/engine";
import { exportDocument } from "../export/client";
import { documentStore } from "../state/store";
import { addDetectedFields, detectFormRectangles, occupiedFormBoxes, overlaps, type FormCandidate } from "./detection";
import { flushInlineText } from "../editor/flushInlineText";
export function FormDetection({ model, active, fields, disabled }: { model: DocumentModel; active: string; fields: FormDescriptor[]; disabled: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const [result, setResult] = useState<{ snapshot: DocumentModel; pageId: string; candidates: FormCandidate[]; selected: Set<number>; preview: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function detect() {
    if (!flushInlineText()) return;
    setBusy(true); setError(""); setStatus(""); setResult(null);
    const control = new AbortController(); controller.current = control;
    try {
      const snapshot = documentStore.document;
      if (!snapshot || snapshot.id !== model.id) throw Error("文書が切り替わりました。");
      const index = snapshot.pages.findIndex(page => page.id === active);
      if (index < 0) throw Error("検出するページを選択してください。");
      const page = snapshot.pages[index];
      if (page.objects.some(object => object.kind === "redaction")) throw Error("先に墨消し候補を適用するか削除してください。");
      const bytes = await exportDocument({ ...snapshot, pages: snapshot.pages.map((p, i) => i === index ? { ...p, crop: undefined, rotation: 0 } : p), flattenForms: true }, undefined, control.signal, [index]);
      const task = getDocument({ data: bytes });
      const cancel = () => { void task.destroy(); }; control.signal.addEventListener("abort", cancel, { once: true });
      const canvas = document.createElement("canvas");
      try {
        const pdf = await task.promise, pdfPage = await pdf.getPage(1);
        const natural = pdfPage.getViewport({ scale: 1, rotation: 0 }), scale = Math.min(1.5, 1600 / Math.max(natural.width, natural.height));
        const viewport = pdfPage.getViewport({ scale, rotation: 0 }); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) throw Error("検出用画像を作成できません。");
        await pdfPage.render({ canvas, viewport, background: "white" }).promise;
        control.signal.throwIfAborted();
        const occupied = occupiedFormBoxes(snapshot, page.id, fields);
        const candidates = detectFormRectangles(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, page.width, page.height)
          .filter(candidate => !occupied.some(box => overlaps(box, candidate)) && (!page.crop || candidate.x >= page.crop.x && candidate.y >= page.crop.y && candidate.x + candidate.width <= page.crop.x + page.crop.width && candidate.y + candidate.height <= page.crop.y + page.crop.height));
        if (snapshot !== documentStore.document) throw Error("文書が変更されました。もう一度検出してください。");
        setResult({ snapshot, pageId: page.id, candidates, selected: new Set(candidates.map((_, i) => i)), preview: canvas.toDataURL("image/png") });
        setStatus(`${candidates.length}件の候補。枠のない欄・記入済みの欄・傾いた枠は検出対象外です。`);
      } finally { control.signal.removeEventListener("abort", cancel); canvas.width = canvas.height = 0; await task.destroy(); }
    } catch (reason) { setError(control.signal.aborted ? "検出をキャンセルしました。" : reason instanceof Error ? reason.message : "検出できませんでした。"); }
    finally { setBusy(false); controller.current = null; }
  }
  function add() {
    if (!result) return;
    try {
      documentStore.execute(addDetectedFields(result.snapshot, result.pageId, result.candidates.filter((_, i) => result.selected.has(i)), fields));
      setStatus(`${result.selected.size}件を追加しました。作成・編集画面で位置や設定を調整できます。Undoで戻せます。`); setResult(null); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "追加できませんでした。"); }
  }
  const stale = result && result.snapshot !== model;
  return <section className="form-detection">
    <p className="hint">現在のページの空の長方形を文字入力欄、8〜30ptの正方形をチェック欄の候補にします。スキャン画像も対象です。最大200件。誤検出を除外してから追加してください。項目名や意味の自動判定には対応していません。プレビューは回転前の向きです。</p>
    <button disabled={busy || disabled} onClick={() => void detect()}>現在のページから入力枠を検出</button>{busy && <button onClick={() => controller.current?.abort()}>検出をキャンセル</button>}
    {status && <p role="status">{status}</p>}{(error || stale) && <p role="alert" className="warning">{stale ? "文書が変更されました。もう一度検出してください。" : error}</p>}
    {result && <>
      <div className="detection-preview" style={{ aspectRatio: `${result.snapshot.pages.find(p => p.id === result.pageId)!.width} / ${result.snapshot.pages.find(p => p.id === result.pageId)!.height}` }}>
        <img src={result.preview} alt="フォーム候補の検出元ページ" />
        <svg viewBox={`0 0 ${result.snapshot.pages.find(p => p.id === result.pageId)!.width} ${result.snapshot.pages.find(p => p.id === result.pageId)!.height}`} aria-label="フォーム候補の位置">
          {result.candidates.map((candidate, i) => <g key={i}><rect {...{ x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height }} fill={result.selected.has(i) ? "#13a99c33" : "#e34b4b22"} stroke={result.selected.has(i) ? "#008577" : "#c33"} strokeWidth={1.5} /><text x={candidate.x} y={candidate.y - 2} fontSize={10} fill="#00564e">{i + 1}</text></g>)}
        </svg>
      </div>
      <div className="form-kind-buttons"><button disabled={busy || !!stale} onClick={() => setResult({ ...result, selected: new Set(result.candidates.map((_, i) => i)) })}>候補をすべて選択</button><button onClick={() => setResult({ ...result, selected: new Set() })}>候補の選択を解除</button></div>
      {result.candidates.map((candidate, i) => <div className="detected-field" key={i}>
        <label className="check"><input aria-label={`候補${i + 1}を追加`} type="checkbox" disabled={!!stale} checked={result.selected.has(i)} onChange={event => { const selected = new Set(result.selected); if (event.target.checked) selected.add(i); else selected.delete(i); setResult({ ...result, selected }); }} />{i + 1}</label>
        <input aria-label={`候補${i + 1}の名前`} maxLength={500} disabled={!!stale} value={candidate.name} onChange={event => setResult({ ...result, candidates: result.candidates.map((c, index) => index === i ? { ...c, name: event.target.value } : c) })} />
        <select aria-label={`候補${i + 1}の種類`} disabled={!!stale} value={candidate.kind} onChange={event => setResult({ ...result, candidates: result.candidates.map((c, index) => index === i ? { ...c, kind: event.target.value as FormCandidate["kind"] } : c) })}><option value="text">文字入力</option><option value="checkbox">チェック</option></select>
      </div>)}
      <button className="primary" disabled={busy || !!stale || !result.selected.size || disabled} onClick={add}>選択した候補をフォームに追加（{result.selected.size}件）</button>
    </>}
  </section>;
}
