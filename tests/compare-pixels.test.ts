import { describe, expect, it } from "vitest";
import { comparePixels } from "../src/compare/pixels";

function rgba(width: number, height: number, color: [number, number, number, number]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(color, i);
  return pixels;
}

describe("comparePixels", () => {
  it("treats matching pixels and RGB changes within the threshold as equal", () => {
    const left = rgba(2, 1, [100, 120, 140, 255]);
    const right = rgba(2, 1, [124, 96, 150, 255]);
    const result = comparePixels(left, right, 2, 1, 24);
    expect(result.changedPixels).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.regions).toEqual([]);
  });

  it("composites transparent pixels over white before comparing", () => {
    const transparent = rgba(1, 1, [0, 0, 0, 0]);
    const white = rgba(1, 1, [255, 255, 255, 255]);
    expect(comparePixels(transparent, white, 1, 1).changedPixels).toBe(0);

    const opaqueBlack = rgba(1, 1, [0, 0, 0, 255]);
    const opaqueWhite = rgba(1, 1, [255, 255, 255, 255]);
    expect(comparePixels(opaqueBlack, opaqueWhite, 1, 1).changedPixels).toBe(1);
  });

  it("counts pixels whose maximum RGB channel delta exceeds the threshold", () => {
    const left = rgba(3, 1, [0, 0, 0, 255]);
    const right = rgba(3, 1, [0, 0, 0, 255]);
    right.set([24, 25, 0, 255], 4);
    const result = comparePixels(left, right, 3, 1, 24);
    expect(result.changedPixels).toBe(1);
    expect(result.ratio).toBeCloseTo(1 / 3);
  });

  it("returns separate bounded regions for distant changed tile clusters", () => {
    const left = rgba(48, 32, [0, 0, 0, 255]);
    const right = rgba(48, 32, [0, 0, 0, 255]);
    right.set([255, 0, 255, 255], (2 * 48 + 3) * 4);
    right.set([255, 0, 255, 255], (18 * 48 + 34) * 4);

    const result = comparePixels(left, right, 48, 32);
    expect(result.changedPixels).toBe(2);
    expect(result.regions).toHaveLength(2);
    expect(result.regions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 0, y: 0, width: 16, height: 16 }),
        expect.objectContaining({ x: 32, y: 16, width: 16, height: 16 }),
      ]),
    );
  });

  it("limits the returned regions to the 200 largest tile clusters", () => {
    const width = 640, height = 640;
    const left = rgba(width, height, [0, 0, 0, 255]);
    const right = rgba(width, height, [0, 0, 0, 255]);
    for (let row = 0; row < 15; row++) for (let col = 0; col < 15; col++) {
      right.set([255, 0, 255, 255], ((row * 2 * 16) * width + col * 2 * 16) * 4);
    }
    const result = comparePixels(left, right, width, height);
    expect(result.changedPixels).toBe(225);
    expect(result.regions).toHaveLength(200);
  });

  it("clips a changed tile at the image edge", () => {
    const left = rgba(17, 17, [0, 0, 0, 255]);
    const right = rgba(17, 17, [0, 0, 0, 255]);
    right.set([255, 0, 255, 255], (16 * 17 + 16) * 4);
    expect(comparePixels(left, right, 17, 17).regions).toEqual([
      { x: 16, y: 16, width: 1, height: 1 },
    ]);
  });

  it("rejects invalid dimensions, buffers, and thresholds", () => {
    const one = rgba(1, 1, [0, 0, 0, 255]);
    expect(() => comparePixels(one, one, 0, 1)).toThrow();
    expect(() => comparePixels(one, one, 4097, 1)).toThrow();
    expect(() => comparePixels(new Uint8ClampedArray(0), new Uint8ClampedArray(0), 4096, 4096)).toThrow();
    expect(() => comparePixels(one, one, 2, 1)).toThrow();
    expect(() => comparePixels(one, one.subarray(0, 2), 1, 1)).toThrow();
    expect(() => comparePixels(one, one, 1, 1, -1)).toThrow();
    expect(() => comparePixels(one, one, 1, 1, 256)).toThrow();
    expect(() => comparePixels(one, one, 1, 1, 1.5)).toThrow();
    expect(() => comparePixels(one, one, Number.NaN, 1)).toThrow();
    expect(() => comparePixels(one, one, 1, 1, Number.NaN)).toThrow();
  });
});
