/** User ranges are one-based, inclusive; output is zero-based and deduplicated. */
export function parseRange(input: string, count: number): number[] {
  if (!input.trim()) return Array.from({ length: count }, (_, i) => i);
  const result = new Set<number>();
  for (const part of input.split(",")) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) throw new Error("ページ範囲は 1-3,5 の形式で入力してください。");
    const a = Number(m[1]),
      b = Number(m[2] ?? a);
    if (a < 1 || b < a || b > count)
      throw new Error(`ページは 1〜${count} の範囲で指定してください。`);
    for (let i = a; i <= b; i++) result.add(i - 1);
  }
  return [...result];
}
