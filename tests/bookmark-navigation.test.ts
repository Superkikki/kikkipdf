import { describe, expect, it } from "vitest";
import { blankPage } from "../src/state/model";
import type { BookmarkDestination, PageModel } from "../src/state/model";
import {
  bookmarkDisplayPoint,
  resolveBookmarkView,
  type BookmarkViewport,
} from "../src/viewer/bookmarkNavigation";

const basePage = (): PageModel => ({
  ...blankPage(),
  width: 600,
  height: 1000,
  crop: { x: 20, y: 30, width: 500, height: 800 },
});

const viewport: BookmarkViewport = {
  viewBox: [40, 60, 640, 1060],
  convertToViewportPoint: (x, y) => [x - 40, 1060 - y],
  convertToPdfPoint: (x, y) => [x + 40, 1060 - y],
};

describe("bookmark navigation coordinates", () => {
  it("maps raw PDF coordinates through crop and each quarter turn", () => {
    const expected = new Map([
      [0, { x: 40, y: 830 }],
      [90, { x: -30, y: 40 }],
      [180, { x: 460, y: -30 }],
      [270, { x: 830, y: 460 }],
    ]);
    for (const [rotation, point] of expected) {
      expect(bookmarkDisplayPoint({ ...basePage(), rotation }, viewport, 100, 200)).toEqual(point);
    }
  });

  it("uses the changed crop box before applying rotation", () => {
    const page = { ...basePage(), crop: { x: 40, y: 60, width: 300, height: 400 }, rotation: 90 as const };
    expect(bookmarkDisplayPoint(page, viewport, 100, 200)).toEqual({ x: -400, y: 20 });
  });

  it("preserves XYZ null and zero values and clamps explicit zoom", () => {
    const page = basePage();
    const resolve = (destination: BookmarkDestination, currentZoom: "width" | "page" | number = 1.5) =>
      resolveBookmarkView(page, viewport, destination, { width: 804, height: 1040 }, currentZoom);

    expect(resolve({ kind: "XYZ", left: null, top: null, zoom: null }, "width")).toEqual({
      zoom: "width", point: { x: 0, y: 0 },
    });
    expect(resolve({ kind: "XYZ", left: 0, top: 0, zoom: 0 }, "page")).toEqual({
      zoom: "page", point: { x: -60, y: 1030 },
    });
    expect(resolve({ kind: "XYZ", left: 100, top: 200, zoom: 0.1 })).toEqual({
      zoom: 0.25, point: { x: 40, y: 830 },
    });
    expect(resolve({ kind: "XYZ", left: 100, top: 200, zoom: 8 }).zoom).toBe(4);
  });

  it("resolves FitH and FitV scale and anchor from the crop edges", () => {
    const page = basePage();
    const space = { width: 804, height: 840 };
    expect(resolveBookmarkView(page, viewport, { kind: "FitH", top: 600 }, space, 2)).toEqual({
      zoom: "width", point: { x: 0, y: 430 },
    });
    expect(resolveBookmarkView(page, viewport, { kind: "FitV", left: 100 }, space, 2)).toEqual({
      zoom: 1, point: { x: 40, y: 0 },
    });
    expect(resolveBookmarkView(page, viewport, { kind: "FitV", left: null }, space, 2)).toEqual({
      zoom: 1, point: { x: 0, y: 0 },
    });
  });

  it("fits FitR bounds using displayed crop coordinates and available space", () => {
    const page = basePage();
    expect(resolveBookmarkView(
      page,
      viewport,
      { kind: "FitR", left: 100, bottom: 200, right: 300, top: 600 },
      { width: 404, height: 440 },
      2,
    )).toEqual({ zoom: 1, point: { x: 40, y: 430 } });
    expect(resolveBookmarkView(
      { ...page, rotation: 90 },
      viewport,
      { kind: "FitR", left: 100, bottom: 200, right: 300, top: 600 },
      { width: 404, height: 440 },
      2,
    )).toEqual({ zoom: 1, point: { x: -30, y: 40 } });
  });
});
