import { useState } from "react";
import type { DocumentModel } from "../state/model";
import { documentStore } from "../state/store";
import { addBatesNumbers, planBates, type BatesOptions } from "./bates";

export function BatesEditor({ model, close }: { model: DocumentModel; close: () => void }) {
  const [snapshot] = useState(model);
  const [range, setRange] = useState(""), [prefix, setPrefix] = useState(""), [suffix, setSuffix] = useState("");
  const [start, setStart] = useState("1"), [digits, setDigits] = useState("6"), [margin, setMargin] = useState("24"), [fontSize, setFontSize] = useState("11");
  const [position, setPosition] = useState<BatesOptions["position"]>("bottom-right"), [color, setColor] = useState("#000000"), [error, setError] = useState("");
  const options: BatesOptions = { range, prefix, suffix, start: start === "" ? NaN : Number(start), digits: digits === "" ? NaN : Number(digits), margin: margin === "" ? NaN : Number(margin), fontSize: fontSize === "" ? NaN : Number(fontSize), position, color };
  let items: ReturnType<typeof planBates> = [], previewError = "";
  try { items = planBates(snapshot, options); } catch (reason) { previewError = reason instanceof Error ? reason.message : "番号を作成できません。"; }
  const stale = snapshot !== model, shown = items.length > 6 ? [...items.slice(0, 3), ...items.slice(-3)] : items;
  function apply() {
    try { documentStore.execute(addBatesNumbers(snapshot, options)); close(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "番号を追加できません。"); }
  }
  return <form onSubmit={event => { event.preventDefault(); if (!previewError && !stale) apply(); }}>
    <div className="dialog-body bates-editor">
      <p className="hint">選択したページに管理番号を印字します。接頭辞・接尾辞は半角英数字と記号に対応します。番号はページ順で連続し、適用後は通常のテキストとして個別に編集できます。ページを並べ替えても番号は自動で変わりません。</p>
      <label>ページ範囲（空欄は全ページ）<input data-autofocus aria-label="ベイツ番号を付けるページ範囲" placeholder="例: 1-3,5" value={range} onChange={event => setRange(event.target.value)} /></label>
      <div className="bates-grid"><label>接頭辞<input aria-label="ベイツ番号の接頭辞" maxLength={64} value={prefix} onChange={event => setPrefix(event.target.value)} placeholder="例: CASE-" /></label>
      <label>接尾辞<input aria-label="ベイツ番号の接尾辞" maxLength={64} value={suffix} onChange={event => setSuffix(event.target.value)} /></label>
      <label>開始番号<input aria-label="ベイツ番号の開始番号" type="number" min={0} max={999999999999} step={1} value={start} onChange={event => setStart(event.target.value)} /></label>
      <label>番号の桁数<input aria-label="ベイツ番号の桁数" type="number" min={1} max={12} step={1} value={digits} onChange={event => setDigits(event.target.value)} /></label>
      <label>配置<select aria-label="ベイツ番号の配置" value={position} onChange={event => setPosition(event.target.value as BatesOptions["position"])}><option value="top-left">左上</option><option value="top-center">中央上</option><option value="top-right">右上</option><option value="bottom-left">左下</option><option value="bottom-center">中央下</option><option value="bottom-right">右下</option></select></label>
      <label>余白（pt）<input aria-label="ベイツ番号の余白" type="number" min={6} max={144} step={1} value={margin} onChange={event => setMargin(event.target.value)} /></label>
      <label>文字サイズ（pt）<input aria-label="ベイツ番号の文字サイズ" type="number" min={6} max={36} step={1} value={fontSize} onChange={event => setFontSize(event.target.value)} /></label>
      <label>文字色<input aria-label="ベイツ番号の文字色" type="color" value={color} onChange={event => setColor(event.target.value)} /></label></div>
      <p className="hint">余白と位置は回転・トリミング後の表示面を基準にします。長い番号はページ幅からはみ出す場合があります。印字結果を確認してください。</p>
      {(previewError || stale || error) && <p className="warning" role="alert">{stale ? "文書が変更されました。画面を開き直してください。" : error || previewError}</p>}
      {!previewError && <div className="bates-preview" aria-label="ベイツ番号のプレビュー"><strong>{items.length}ページの変更予定</strong><table><thead><tr><th>ページ</th><th>印字する番号</th></tr></thead><tbody>{shown.map((item, i) => <tr key={item.pageId}><td>{items.length > 6 && i === 3 ? "… " : ""}{item.pageIndex + 1}</td><td>{item.text}</td></tr>)}</tbody></table>{items.length > 6 && <p className="hint">先頭3件と末尾3件を表示しています。</p>}</div>}
    </div>
    <footer><button type="button" onClick={close}>キャンセル</button><button className="primary" type="submit" disabled={!!previewError || !!stale}>番号を追加</button></footer>
  </form>;
}
