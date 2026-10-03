export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  normalizeWidth: boolean;
}
export const defaultSearchOptions: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  normalizeWidth: true,
};
export interface SearchPart {
  key: string;
  text: string;
  hasEOL?: boolean;
}
export interface SearchFragment {
  key: string;
  start: number;
  end: number;
}
export interface TextMatch {
  start: number;
  end: number;
  before: string;
  match: string;
  after: string;
  fragments: SearchFragment[];
}
export interface SearchHit extends TextMatch {
  id: string;
  pageId: string;
  pageNumber: number;
}
export const SEARCH_RESULT_LIMIT = 5000;
export const SEARCH_PAGE_SIZE = 100;
const graphemes = new Intl.Segmenter("ja", { granularity: "grapheme" });
const wordCharacter = /[\p{L}\p{N}\p{M}_]/u;

/** Keep UTF-16 offsets into the original text even when normalization expands
 * a ligature, composes combining marks, or lowercasing changes its length. */
function normalize(text: string, options: SearchOptions) {
  let value = "";
  const starts: number[] = [], ends: number[] = [];
  for (const { segment, index } of graphemes.segment(text)) {
    let normalized = segment.normalize(options.normalizeWidth ? "NFKC" : "NFC");
    if (!options.caseSensitive) normalized = normalized.toLowerCase();
    for (const char of normalized) {
      const space = /\s/u.test(char);
      if (space && value.endsWith(" ")) {
        ends[ends.length - 1] = index + segment.length;
        continue;
      }
      const addition = space ? " " : char;
      value += addition;
      for (let i = 0; i < addition.length; i++) {
        starts.push(index);
        ends.push(index + segment.length);
      }
    }
  }
  return { value, starts, ends };
}

/** Parts are in PDF.js text-layer order. EOL is searchable as whitespace;
 * adjacent chunks of a word are joined without introducing false spaces. */
export function findTextMatches(
  parts: SearchPart[], query: string, options = defaultSearchOptions,
  limit = SEARCH_RESULT_LIMIT,
): TextMatch[] {
  const needle = normalize(query.trim(), options).value;
  if (!needle || limit <= 0) return [];
  let text = "";
  const ranges = parts.map((part) => {
    const start = text.length;
    text += part.text;
    const end = text.length;
    if (part.hasEOL) text += "\n";
    return { key: part.key, start, end };
  });
  const normalized = normalize(text, options);
  const results: TextMatch[] = [];
  let from = 0, lastEnd = -1, partIndex = 0;
  while (results.length < limit) {
    const index = normalized.value.indexOf(needle, from);
    if (index < 0) break;
    from = index + needle.length;
    const before = Array.from(normalized.value.slice(Math.max(0, index - 2), index)).at(-1) ?? "";
    const after = Array.from(normalized.value.slice(from, from + 2))[0] ?? "";
    if (options.wholeWord && (wordCharacter.test(before) || wordCharacter.test(after))) continue;
    const start = normalized.starts[index], end = normalized.ends[from - 1];
    // An expanded source glyph must never produce duplicate overlapping hits.
    if (start < lastEnd) continue;
    lastEnd = end;
    const fragments: SearchFragment[] = [];
    while (partIndex < ranges.length && ranges[partIndex].end <= start) partIndex++;
    for (let i = partIndex; i < ranges.length && ranges[i].start < end; i++) {
      const part = ranges[i];
      if (part.end > part.start) fragments.push({ key: part.key,
        start: Math.max(start, part.start) - part.start, end: Math.min(end, part.end) - part.start });
    }
    results.push({
      start, end,
      before: text.slice(Math.max(0, start - 22), start),
      match: text.slice(start, end),
      after: text.slice(end, end + 40),
      fragments,
    });
  }
  return results;
}
