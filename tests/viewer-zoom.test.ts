import { describe, expect, it } from "vitest";
import { pageScale, stepZoom, wheelZoom } from "../src/viewer/zoom";

describe("viewer zoom", () => {
  it("uses the available content width without subtracting sidebar padding twice", () => {
    const page = { width: 420, height: 595 };
    const scale = pageScale(page, { width: 800, height: 500 }, "width");
    expect(page.width * scale).toBeCloseTo(796);
    expect(scale).toBeGreaterThan(1);
  });
  it("fits both portrait and landscape pages including space for the caption", () => {
    const space = { width: 800, height: 500 };
    for (const page of [{ width: 420, height: 595 }, { width: 595, height: 420 }]) {
      const scale = pageScale(page, space, "page");
      expect(page.width * scale).toBeLessThanOrEqual(space.width - 4);
      expect(page.height * scale).toBeLessThanOrEqual(space.height - 40 + 0.001);
      expect(scale).toBeLessThanOrEqual(pageScale(page, space, "width"));
    }
  });
  it("keeps fixed zoom independent of window dimensions and bounds automatic fitting", () => {
    const page = { width: 420, height: 595 };
    expect(pageScale(page, { width: 300, height: 200 }, 1.13)).toBe(1.13);
    expect(pageScale(page, { width: 12000, height: 12000 }, "width")).toBe(4);
    expect(pageScale(page, { width: 10, height: 10 }, "page")).toBe(0.15);
  });
  it("steps from the displayed fit scale and keeps stable percentage precision", () => {
    expect(stepZoom(0.723456, 1)).toBe(0.97);
    expect(stepZoom(1.893456, -1)).toBe(1.64);
    expect(stepZoom(1.13, 1)).toBe(1.38);
    expect(stepZoom(1.38, -1)).toBe(1.13);
  });
  it("clamps increments and decrements to supported fixed zoom limits", () => {
    expect(stepZoom(3.92, 1)).toBe(4);
    expect(stepZoom(0.4, -1)).toBe(0.25);
    expect(stepZoom(0.15, 1)).toBe(0.4);
  });
});

it("normalizes wheel units, accumulates small pinch deltas and clamps zoom", () => {
  expect(wheelZoom(1, -100)).toBeCloseTo(Math.exp(0.2));
  expect(wheelZoom(1, 1, 1)).toBeCloseTo(wheelZoom(1, 16));
  expect(wheelZoom(1, 1, 2)).toBeCloseTo(wheelZoom(1, 800));
  let scale = 1;
  for (let i = 0; i < 8; i++) scale = wheelZoom(scale, -3);
  expect(scale).toBeCloseTo(wheelZoom(1, -24));
  expect(wheelZoom(4, -100)).toBe(4);
  expect(wheelZoom(0.25, 100)).toBe(0.25);
});
