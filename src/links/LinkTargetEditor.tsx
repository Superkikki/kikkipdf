import type { LinkTarget, PageModel } from "../state/model";
export function LinkTargetEditor({
  target,
  pages,
  onChange,
}: {
  target?: LinkTarget;
  pages: PageModel[];
  onChange: (target: LinkTarget) => void;
}) {
  return (
    <div className="link-target-editor">
      <label>
        リンクの種類
        <select
          aria-label="リンクの種類"
          value={target?.kind ?? "page"}
          onChange={(e) =>
            onChange(
              e.target.value === "page"
                ? { kind: "page", pageId: pages[0].id }
                : { kind: "url", url: "https://" },
            )
          }
        >
          <option value="page">文書内のページ</option>
          <option value="url">Web / メール</option>
        </select>
      </label>
      {target?.kind === "url" ? (
        <label>
          リンクURL
          <input
            aria-label="リンクURL"
            value={target.url}
            placeholder="https://…"
            onChange={(e) => onChange({ kind: "url", url: e.target.value })}
          />
        </label>
      ) : (
        <label>
          リンク先ページ
          <select
            aria-label="リンク先ページ"
            value={target?.pageId ?? ""}
            onChange={(e) => onChange({ kind: "page", pageId: e.target.value })}
          >
            <option value="">移動先を選択</option>
            {pages.map((p, i) => (
              <option key={p.id} value={p.id}>
                {i + 1} ページ
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
