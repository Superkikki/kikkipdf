/** Only passive, explicit URL destinations can be stored by the editor. No launch or script actions. */
export function validatedLinkUrl(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length > 8192 ||
    Array.from(trimmed).some((c) => c.charCodeAt(0) < 32)
  )
    throw Error("リンクURLが不正です。");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw Error(
      "リンクには完全なhttps://、http://、mailto:のURLを入力してください。",
    );
  }
  if (
    !["https:", "http:", "mailto:"].includes(parsed.protocol) ||
    (parsed.protocol === "mailto:" && !parsed.pathname)
  )
    throw Error("リンクはhttps://、http://、mailto:に対応しています。");
  return parsed.href;
}

/** Some producers write UTF-16 PDF strings into URI actions; PDF.js exposes those as unsafeUrl. */
export function importedLinkUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 16384) return;
  let url = value;
  if (value.charCodeAt(0) === 0xfe && value.charCodeAt(1) === 0xff)
    url = new TextDecoder("utf-16be").decode(
      Uint8Array.from(value, (c) => c.charCodeAt(0)),
    );
  else if (value.charCodeAt(0) === 0xff && value.charCodeAt(1) === 0xfe)
    url = new TextDecoder("utf-16le").decode(
      Uint8Array.from(value, (c) => c.charCodeAt(0)),
    );
  try {
    return validatedLinkUrl(url);
  } catch {
    return;
  }
}
