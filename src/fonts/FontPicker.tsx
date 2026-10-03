import { useEffect, useRef, useState } from "react";
import type { EditObject } from "../state/model";
import { documentStore } from "../state/store";
import { pickFiles } from "../platform/files";
import { inspectLocalFont } from "../export/client";
import { registerFont, removeUnusedFonts } from "./commands";
import { useFontFace } from "./useFontFace";
export function FontPicker({
  object,
  pageId,
  patch,
}: {
  object: EditObject;
  pageId: string;
  patch: (patch: Partial<EditObject>) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const fonts = documentStore.document?.fonts ?? {};
  const face = useFontFace(object.fontId ? fonts[object.fontId] : undefined);
  const used = new Set(
    documentStore.document?.pages.flatMap((p) =>
      p.objects.filter((o) => o.font === "custom").map((o) => o.fontId),
    ),
  );
  const unused = Object.keys(fonts).filter((id) => !used.has(id)).length;
  const add = async () => {
    const documentId = documentStore.document?.id;
    setBusy(true);
    setError("");
    try {
      const [file] = await pickFiles("font");
      if (!file) return;
      const asset = await inspectLocalFont(file.bytes, file.name);
      if (mounted.current && documentId === documentStore.document?.id)
        documentStore.execute(registerFont(asset, pageId, object.id));
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "フォントを登録できません。");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      <label>
        フォント
        <select
          aria-label="フォント"
          value={object.font === "custom" ? object.fontId : object.font}
          onChange={(e) => {
            setError("");
            const value = e.target.value;
            patch(
              value.startsWith("font-")
                ? { font: "custom", fontId: value, bold: false, italic: false }
                : { font: value as EditObject["font"], fontId: undefined },
            );
          }}
        >
          <option value="japanese">Noto Sans JP（日本語）</option>
          <option disabled={object.writingMode === "vertical"} value="sans">Helvetica</option>
          <option disabled={object.writingMode === "vertical"} value="serif">Times</option>
          <option disabled={object.writingMode === "vertical"} value="mono">Courier</option>
          {Object.values(fonts).map((f) => (
            <option key={f.id} value={f.id}>
              {f.family} · {f.name}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy} onClick={() => void add()}>
        {busy ? "フォントを確認中…" : "フォントを追加"}
      </button>
      <p className="hint">
        静的TTF／OTF。PDFと編集プロジェクトにフォントデータを含めます。利用するフォントのライセンスをご確認ください。
      </p>
      {unused > 0 && (
        <button
          disabled={busy}
          onClick={() => documentStore.execute(removeUnusedFonts())}
        >
          未使用フォントを削除（{unused}件）
        </button>
      )}
      {(error || face.error) && (
        <p role="alert" className="warning small">
          {error || face.error}
        </p>
      )}
    </>
  );
}
