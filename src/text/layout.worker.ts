/// <reference lib="webworker" />
import { PDFDocument, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { embedTextFont, fontKey, assertGlyphs } from "./fonts";
import type { FontAsset } from "../state/model";
import { layoutVertical } from "./vertical";
import { layoutText, type TextStyle } from "./layout";

const document = PDFDocument.create().then((doc) => {
  doc.registerFontkit(fontkit);
  return doc;
});
const fonts = new Map<string, Promise<PDFFont>>();
const assets = new Map<string, FontAsset>();
let japanese: Promise<Uint8Array> | undefined;
self.onmessage = async (
  e: MessageEvent<{ id: number; style: TextStyle; font?: FontAsset }>,
) => {
  const { id, style } = e.data;
  try {
    if (e.data.font) assets.set(e.data.font.id, e.data.font);
    if (style.font === "japanese") japanese ??= fetch("/assets/NotoSansJP-Regular.otf").then(async response => {
      if (!response.ok) throw Error("ローカル日本語フォントを読み込めません。");
      return new Uint8Array(await response.arrayBuffer());
    });
    if (style.writingMode === "vertical") {
      const bytes = style.font === "japanese" ? await japanese : assets.get(style.fontId ?? "")?.bytes;
      if (!bytes) throw Error("縦書きフォントが見つかりません。");
      postMessage({ id, result: layoutVertical(style, bytes) }); return;
    }
    const key = fontKey(style);
    let pending = fonts.get(key);
    if (!pending) {
      pending = (async () => {
        return embedTextFont(
          await document,
          style,
          style.font === "japanese" ? await japanese : undefined,
          assets.get(style.fontId ?? ""),
        );
      })();
      fonts.set(key, pending);
      pending.catch(() => fonts.delete(key));
    }
    const font = await pending;
    if (style.font === "custom") assertGlyphs(font, style.text ?? "");
    postMessage({
      id,
      result: layoutText(style, (text) =>
        font.widthOfTextAtSize(text, style.fontSize),
      ),
    });
  } catch (error) {
    postMessage({
      id,
      error:
        error instanceof Error
          ? error.message
          : "文字のレイアウトに失敗しました。",
    });
  }
};
