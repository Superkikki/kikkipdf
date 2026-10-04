import tables from "./fontTables";

const own = <T>(table: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

export function fontEncoding(name: string): string[] | undefined {
  return own(tables.encodings as Record<string, string[]>, name);
}
export function standardWidths(name: string): Record<string, number> | undefined {
  return own(tables.widths as Record<string, Record<string, number>>, name);
}
/** Adobe Glyph List rules: remove suffix, split components, then uni/u names. */
export function glyphUnicode(name: string): string | undefined {
  if (!name || name.length > 256) return undefined;
  const parts = name.split(".")[0].split("_");
  let result = "";
  for (const part of parts) {
    const known = own(tables.glyphs as Record<string, number>, part);
    if (known !== undefined) {
      result += String.fromCodePoint(known);
      continue;
    }
    const codes = /^uni(?:[0-9A-F]{4})+$/.test(part)
      ? part.slice(3).match(/.{4}/g)!.map(n => parseInt(n, 16))
      : /^u[0-9A-F]{4,6}$/.test(part) ? [parseInt(part.slice(1), 16)] : [];
    if (!codes.length || codes.some(n => n > 0x10ffff || n >= 0xd800 && n <= 0xdfff))
      return undefined;
    result += String.fromCodePoint(...codes);
  }
  return result || undefined;
}
