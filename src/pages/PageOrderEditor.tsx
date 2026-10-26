import { useState } from "react";
import type { DocumentModel } from "../state/model";
import { documentStore } from "../state/store";
import { pageLabel } from "./labels";
import { parsePageOrder, pageOrderPreset, reorderAllPages, type PageOrderPreset } from "./order";

export function PageOrderEditor({ model, close }: { model: DocumentModel; close: () => void }) {
  const [snapshot] = useState(model);
  const [mode, setMode] = useState<"manual" | PageOrderPreset>("manual"), [manual, setManual] = useState(`1-${snapshot.pages.length}`);
  const [front, setFront] = useState(String(Math.ceil(snapshot.pages.length / 2))), [reverseBack, setReverseBack] = useState(true);
  const [error, setError] = useState("");
  const stale = snapshot !== model;
  let order: number[] = [], previewError = "";
  try { order = mode === "manual" ? parsePageOrder(manual, snapshot.pages.length) : pageOrderPreset(snapshot.pages.length, mode, Number(front), reverseBack); }
  catch (reason) { previewError = reason instanceof Error ? reason.message : "ページ順序が不正です。"; }
  const positions = order.length > 12 ? [...Array.from({ length: 6 }, (_, i) => i), ...Array.from({ length: 6 }, (_, i) => order.length - 6 + i)] : order.map((_, i) => i);
  function apply() {
    try { documentStore.execute(reorderAllPages(snapshot, order)); close(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "ページ順序を変更できません。"); }
  }
  return <form className="page-order-editor" onSubmit={event => { event.preventDefault(); if (!previewError && !stale) apply(); }}>
    <div className="dialog-body page-order-fields">
    <p className="hint">この画面を開いた時点のページ番号で、全ページの順序を指定します。ページラベル・編集内容・しおりの移動先はページと一緒に保持します。</p>
    <label>並べ方<select data-autofocus aria-label="ページの並べ方" value={mode} onChange={event => { setMode(event.target.value as typeof mode); setError(""); }}>
      <option value="manual">ページ番号で指定</option><option value="reverse">全体を逆順</option>
      <option value="oddEven">奇数ページ→偶数ページ</option><option value="evenOdd">偶数ページ→奇数ページ</option>
      <option value="interleave" disabled={snapshot.pages.length < 2}>前半と後半を交互に並べる</option>
    </select></label>
    {mode === "manual" ? <label>変更後のページ順序<textarea aria-label="変更後のページ順序" value={manual} maxLength={100000} rows={3}
      placeholder="例: 3-1,4-6" onChange={event => { setManual(event.target.value); setError(""); }} /></label> :
      <p className="hint">指定する順序: {order.length <= 20 ? order.map(i => i + 1).join(", ") : `${order.slice(0, 10).map(i => i + 1).join(", ")} … ${order.slice(-3).map(i => i + 1).join(", ")}`}</p>}
    {mode === "interleave" && <>
      <label>前半（表面側）のページ数<input aria-label="前半のページ数" type="number" min={1} max={snapshot.pages.length - 1} value={front}
        onChange={event => { setFront(event.target.value); setError(""); }} /></label>
      <label className="check"><input type="checkbox" checked={reverseBack} onChange={event => setReverseBack(event.target.checked)} />後半を逆順にする</label>
      <p className="hint">表面PDFの後ろへ裏面PDFを追加してから使います。前半の1枚目、後半の1枚目…の順に並べ、余ったページは最後へ置きます。裏面を逆順でスキャンした場合はチェックしてください。</p>
    </>}
    <button type="button" disabled={!order.length || mode === "manual"} onClick={() => { setManual(order.map(i => i + 1).join(",")); setMode("manual"); }}>この順序を手動で調整</button>
    {(previewError || stale || error) && <p role="alert" className="warning">{stale ? "文書が変更されました。画面を開き直してください。" : error || previewError}</p>}
    {!previewError && <div className="page-order-preview" aria-label="ページ順序のプレビュー">
      <strong>{order.length}ページの変更予定</strong>
      <table><thead><tr><th>変更後</th><th>現在のページ</th><th>ラベル</th></tr></thead><tbody>
        {positions.map((position, i) => <tr key={position}><td>{i === 6 && order.length > 12 ? "… " : ""}{position + 1}</td>
          <td>{order[position] + 1}</td><td>{pageLabel(snapshot.pages[order[position]], order[position]) || "（空）"}</td></tr>)}
      </tbody></table>
      <p className="hint">{order.length > 12 ? "先頭6件と末尾6件を表示しています。" : ""}10000ページまで。変更全体を一度の「元に戻す」で取り消せます。</p>
    </div>}
    </div>
    <footer><button type="button" onClick={close}>キャンセル</button><button type="submit" className="primary" disabled={!!previewError || stale}>この順序を適用</button></footer>
  </form>;
}
