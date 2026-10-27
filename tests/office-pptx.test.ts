import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { createImagePptx } from "../src/office/pptx";

describe("PowerPoint image export", () => {
  it("creates slides in order with original image bytes and centered dimensions", async () => {
    const one = Uint8Array.from([255, 216, 255, 217]);
    const two = Uint8Array.from([255, 216, 1, 2, 255, 217]);
    const pptx = await createImagePptx([{ bytes: one, width: 400, height: 800 }, { bytes: two, width: 800, height: 400 }]);
    const files = unzipSync(pptx);
    expect(Object.keys(files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(2);
    const presentation = strFromU8(files["ppt/presentation.xml"]);
    expect(presentation).toContain('cx="4572000" cy="9144000"');
    expect(Object.values(files).some(b => b.length === one.length && b.every((v, i) => v === one[i]))).toBe(true);
    expect(Object.values(files).some(b => b.length === two.length && b.every((v, i) => v === two[i]))).toBe(true);
  });
  it("rejects empty or invalid dimensions", async () => {
    await expect(createImagePptx([])).rejects.toThrow();
    await expect(createImagePptx([{ bytes: new Uint8Array([1]), width: 0, height: 1 }])).rejects.toThrow();
  });
});
