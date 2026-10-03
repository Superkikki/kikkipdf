import { useEffect, useRef, useState } from "react";
import type { EditObject } from "../state/model";
import { uid } from "../state/model";
import { documentStore } from "../state/store";
import { extractImageAsset } from "./extract";
import { saveBytes } from "../platform/files";
import { pasteObject } from "../editor/objectActions";
import { pickFiles } from "../platform/files";
import { replaceDirectImage } from "./commands";
import { updateObject } from "../commands/document";
export function ImageReplacement({
  object,
  pageId,
}: {
  object: EditObject;
  pageId: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true);
  const extraction = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      extraction.current?.abort();
    };
  }, []);
  const replace = async () => {
    const documentId = documentStore.document?.id;
    setBusy(true);
    setError("");
    try {
      const [file] = await pickFiles("image");
      if (!file) return;
      if (file.bytes.length > 32 * 1024 * 1024)
        throw Error("差し替え画像は1件32MBまでです。");
      const b = file.bytes;
      const mime =
        b[0] === 255 && b[1] === 216
          ? "image/jpeg"
          : [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n)
            ? "image/png"
            : undefined;
      if (!mime) throw Error("PNGまたはJPEGを選んでください。");
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(b)], { type: mime }),
      );
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (pixels > 64_000_000)
        throw Error("差し替え画像は6400万画素までです。");
      if (mounted.current && documentStore.document?.id === documentId)
        documentStore.execute(
          replaceDirectImage(pageId, object.id, { id: uid(), bytes: b, mime }),
        );
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "画像を差し替えられません。");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const extract = async (duplicate: boolean) => {
    const model = documentStore.document;
    if (!model) return;
    const controller = new AbortController(); extraction.current = controller;
    setBusy(true);
    setError("");
    try {
      const asset = await extractImageAsset(model, object, controller.signal);
      if (
        !mounted.current ||
        documentStore.document?.id !== model.id ||
        documentStore.document.pages
          .find((p) => p.id === pageId)
          ?.objects.find((o) => o.id === object.id) !== object
      )
        return;
      if (duplicate)
        documentStore.execute(
          pasteObject(pageId, { object, image: asset }).command,
        );
      else
        await saveBytes(
          asset.bytes,
          `image-${object.id.slice(0, 8)}.${asset.mime === "image/jpeg" ? "jpg" : "png"}`,
        );
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "画像を取り出せません。");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      <button disabled={busy} onClick={() => void replace()}>
        {busy ? "画像を確認中…" : "画像を差し替える"}
      </button>
      <button
        disabled={busy || object.imageDeleted}
        onClick={() => void extract(false)}
      >
        画像を取り出す
      </button>
      <button
        disabled={busy || object.imageDeleted}
        onClick={() => void extract(true)}
      >
        画像を複製
      </button>
      <p className="hint">
        取り出し・コピーは画像データだけを対象にし、ページの背景や文字を含めません。元画像は透過PNGへ変換します（2000万画素まで）。Ctrl+C／X／V／Dにも対応します。
      </p>
      {object.imageId && (
        <button
          disabled={busy}
          onClick={() =>
            documentStore.execute(
              updateObject(pageId, object.id, {
                imageId: undefined,
                imageDeleted: false,
              }),
            )
          }
        >
          元の画像データに戻す
        </button>
      )}
      <p className="hint">
        PNG／JPEG。その使用箇所だけを差し替え、位置・サイズ・元の重なり順を保ちます。
      </p>
      {error && (
        <p role="alert" className="warning small">
          {error}
        </p>
      )}
    </>
  );
}
