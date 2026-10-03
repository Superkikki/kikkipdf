import { useState } from "react";
import type { DocumentModel } from "../state/model";
import { documentStore } from "../state/store";
import { parseRange } from "./ranges";
import { clearPageLabels, generatePageLabels, pageLabel, setPageLabels, type PageLabelStyle } from "./labels";

export function PageLabelEditor({ model, active, close }: {
  model: DocumentModel;
  active: string;
  close: () => void;
}) {
  const [range, setRange] = useState(String(Math.max(0, model.pages.findIndex((p) => p.id === active)) + 1));
  const [style, setStyle] = useState<PageLabelStyle>("D");
  const [prefix, setPrefix] = useState("");
  const [start, setStart] = useState("1");
  const [error, setError] = useState("");
  const options = { style, prefix, start: style ? Number(start) : 1 };
  let indices: number[] = [], preview: string[] = [], previewError = "";
  try {
    indices = parseRange(range, model.pages.length).sort((a, b) => a - b);
    preview = generatePageLabels(indices.length, options);
  } catch (e) { previewError = e instanceof Error ? e.message : String(e); }
  const exampleIndices = indices.length > 6 ? [...indices.slice(0, 3), ...indices.slice(-3)] : indices;
  function apply(clear: boolean) {
    try {
      const selected = parseRange(range, model.pages.length);
      documentStore.execute(clear ? clearPageLabels(selected) : setPageLabels(selected, options));
      close();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return <form className="page-label-editor" onSubmit={(e) => { e.preventDefault(); apply(false); }}>
    <p className="hint">前付け・本文・付録などのページに表示する番号を設定します。ページ範囲は下部の通常のページ番号で指定してください。</p>
    <label>ページ範囲（空欄は全ページ）
      <input aria-label="ラベルを設定するページ範囲" value={range} placeholder="1-3,5"
        onChange={(e) => { setRange(e.target.value); setError(""); }} />
    </label>
    <div className="page-label-fields">
      <label>番号の形式
        <select aria-label="番号の形式" value={style} onChange={(e) => { setStyle(e.target.value as PageLabelStyle); setError(""); }}>
          <option value="D">1, 2, 3…</option><option value="R">I, II, III…</option>
          <option value="r">i, ii, iii…</option><option value="A">A, B, C…</option>
          <option value="a">a, b, c…</option><option value="">番号なし（接頭辞のみ）</option>
        </select>
      </label>
      <label>開始番号
        <input aria-label="ラベルの開始番号" type="number" min="1" max={style === "r" || style === "R" ? 3999 : 1000000}
          disabled={!style} value={start} onChange={(e) => { setStart(e.target.value); setError(""); }} />
      </label>
    </div>
    <label>接頭辞
      <input aria-label="ラベルの接頭辞" value={prefix} maxLength={128} placeholder="例: 付録-"
        onChange={(e) => { setPrefix(e.target.value); setError(""); }} />
    </label>
    <p className="hint">ラベルはページと一緒に移動・複製されます。同じラベルを複数のページに設定できます。ページ上の印刷される文字は変更しません。</p>
    {previewError ? <p className="warning" role="status">{previewError}</p> : <div className="page-label-preview" aria-label="ページラベルのプレビュー">
      <strong>{indices.length} ページの変更予定</strong>
      <table><thead><tr><th>ページ</th><th>現在</th><th>変更後</th></tr></thead><tbody>
        {exampleIndices.map((index, i) => <tr key={index}>
          <td>{i === 3 && indices.length > 6 ? "… " : ""}{index + 1}</td>
          <td>{pageLabel(model.pages[index], index) || "（空）"}</td>
          <td>{preview[indices.indexOf(index)]}</td>
        </tr>)}
      </tbody></table>
    </div>}
    {error && <p className="warning" role="alert">{error}</p>}
    <footer>
      <button type="button" onClick={() => apply(true)}>ラベルを解除</button>
      <button type="button" onClick={close}>キャンセル</button>
      <button className="primary" type="submit" disabled={!!previewError}>ラベルを適用</button>
    </footer>
  </form>;
}
