import PptxGenJS from "pptxgenjs";

export interface SlideImage { bytes: Uint8Array; width: number; height: number }

/** Each slide contains one image, centered and scaled to the first page's proportions. */
export async function createImagePptx(images: SlideImage[]): Promise<Uint8Array> {
  if (!images.length || images.length > 100) throw Error("PowerPointへの書き出しは1〜100ページまでです。");
  let total = 0;
  for (const image of images) {
    if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0 || !image.bytes.length) throw Error("ページ画像が不正です。");
    total += image.bytes.length;
    if (total > 48 * 1024 * 1024) throw Error("ページ画像の合計が48MBを超えました。ページ範囲を減らしてください。");
  }
  const first = images[0];
  const slideWidth = Math.max(1, 10 * first.width / Math.max(first.width, first.height));
  const slideHeight = Math.max(1, 10 * first.height / Math.max(first.width, first.height));
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "PDF", width: slideWidth, height: slideHeight });
  pptx.layout = "PDF";
  for (const image of images) {
    const scale = Math.min(slideWidth / image.width, slideHeight / image.height);
    const width = image.width * scale, height = image.height * scale;
    let binary = "";
    for (let offset = 0; offset < image.bytes.length; offset += 16_384)
      binary += String.fromCharCode(...image.bytes.subarray(offset, offset + 16_384));
    pptx.addSlide().addImage({ data: `image/jpeg;base64,${btoa(binary)}`, x: (slideWidth - width) / 2, y: (slideHeight - height) / 2, w: width, h: height });
  }
  const data = await pptx.write({ outputType: "arraybuffer", compression: true });
  if (!(data instanceof ArrayBuffer)) throw Error("PowerPointファイルを作成できません。");
  return new Uint8Array(data);
}
