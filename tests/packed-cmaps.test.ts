import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import names from "../src/direct/predefinedCMapNames";
import { parsePackedCMap } from "../src/direct/predefinedCMaps";

it("matches the independent PDF.js decoder for every bundled packed CMap entry", async () => {
  // Use the installed upstream decoder as an oracle, without sharing our parser.
  const source = await readFile("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "utf8");
  const binary = source.slice(source.indexOf("function hexToInt("), source.indexOf(";// ./src/core/ascii_85_stream.js"));
  const mapping = source.slice(source.indexOf("const MAX_MAP_RANGE ="), source.indexOf("class IdentityCMap extends CMap"));
  expect(binary).toContain("class BinaryCMapReader"); expect(mapping).toContain("class CMap");
  class ByteStream {
    at = 0;
    constructor(readonly bytes: Uint8Array) {}
    getByte() { return this.at < this.bytes.length ? this.bytes[this.at++] : -1; }
    getBytes(count: number) { const data = this.bytes.slice(this.at, this.at + count); this.at += count; return data; }
  }
  const decode = runInNewContext(`${binary}\n${mapping}\n(async bytes => {
    const map = new CMap(); let parent;
    await new BinaryCMapReader().process(bytes, map, async name => { parent = name; return map; });
    const values = new Map(); map.forEach((key, value) => values.set(Number(key), value));
    const ranges = map.codespaceRanges.flatMap((values, i) => {
      const result = [];
      for (let n = 0; n < values.length; n += 2) result.push({length: i + 1, low: values[n], high: values[n + 1]});
      return result;
    });
    return {values, ranges, vertical: map.vertical, parent};
  })`, { Stream: ByteStream, FormatError: Error }) as (bytes: Uint8Array) => Promise<{
    values: Map<number, number | string>; ranges: { length: number; low: number; high: number }[]; vertical: boolean; parent?: string;
  }>;
  for (const name of names) {
    const bytes = new Uint8Array(await readFile(`node_modules/pdfjs-dist/cmaps/${name}.bcmap`));
    const actual = parsePackedCMap(bytes), reference = await decode(bytes);
    expect(actual.parent, name).toBe(reference.parent);
    expect(actual.map.vertical, name).toBe(reference.vertical);
    expect(actual.map.values.size, name).toBe(reference.values.size);
    for (const [code, value] of reference.values) {
      if (actual.map.values.get(code) !== value) throw Error(`${name}: mismatched code ${code}`);
    }
    expect([...actual.map.ranges].sort((a, b) => a.length - b.length || a.low - b.low), name).toEqual(reference.ranges);
  }
}, 20000);
