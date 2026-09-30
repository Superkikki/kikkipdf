/// <reference lib="webworker" />
import { PDFDocument, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { embedTextFont, fontKey } from "./fonts";
import { layoutText, type TextStyle } from "./layout";

const document = PDFDocument.create().then((doc) => {
  doc.registerFontkit(fontkit);
  return doc;
});
const fonts = new Map<string, Promise<PDFFont>>();
let japanese: Promise<Uint8Array> | undefined;
self.onmessage = async (e: MessageEvent<{ id: number; style: TextStyle }>) => {
  const { id, style } = e.data;
  try {
    const key = fontKey(style);
    let pending = fonts.get(key);
    if (!pending) {
      pending = (async () => {
        if (style.font === "japanese") {
          japanese ??= fetch("/assets/NotoSansJP-Regular.otf").then(
            async (response) => {
              if (!response.ok)
                throw Error("ローカル日本語フォントを読み込めません。");
              return new Uint8Array(await response.arrayBuffer());
            },
          );
        }
        return embedTextFont(
          await document,
          style,
          style.font === "japanese" ? await japanese : undefined,
        );
      })();
      fonts.set(key, pending);
      pending.catch(() => fonts.delete(key));
    }
    const font = await pending;
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
