export function xmlText(text: string): string {
  let safe = "";
  for (const char of text) {
    const n = char.codePointAt(0)!;
    if (n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff)) safe += char;
    else safe += "\ufffd";
  }
  return safe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

