import {
  mkdir,
  copyFile,
  readdir,
  writeFile,
  access,
  readFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
const checksums = JSON.parse(
  await readFile(new URL("./asset-lock.json", import.meta.url), "utf8"),
);
const root = new URL("../public/assets/", import.meta.url);
await mkdir(root, { recursive: true });
async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const f of await readdir(from, { withFileTypes: true })) {
    if (f.isDirectory())
      await copyTree(new URL(f.name + "/", from), new URL(f.name + "/", to));
    else await copyFile(new URL(f.name, from), new URL(f.name, to));
  }
}
for (const dir of ["cmaps", "standard_fonts", "wasm"])
  await copyTree(
    new URL(`../node_modules/pdfjs-dist/${dir}/`, import.meta.url),
    new URL(`pdfjs/${dir}/`, root),
  );
await mkdir(new URL("ocr/", root), { recursive: true });
await copyFile(
  new URL("../node_modules/tesseract.js/dist/worker.min.js", import.meta.url),
  new URL("ocr/worker.min.js", root),
);
for (const f of await readdir(
  new URL("../node_modules/tesseract.js-core/", import.meta.url),
)) {
  if (/\.wasm(\.js)?$/.test(f))
    await copyFile(
      new URL(`../node_modules/tesseract.js-core/${f}`, import.meta.url),
      new URL(`ocr/${f}`, root),
    );
}
const downloads = {
  "NotoSansJP.ttf":
    "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf",
  "NotoSansJP-OFL.txt":
    "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt",
  "ocr/eng.traineddata":
    "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata",
  "ocr/jpn.traineddata":
    "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/jpn.traineddata",
};
for (const [file, url] of Object.entries(downloads)) {
  try {
    await access(new URL(file, root));
  } catch {
    console.log("Downloading", file);
    const r = await fetch(url);
    if (!r.ok) throw Error(`${file}: ${r.status}`);
    await writeFile(new URL(file, root), new Uint8Array(await r.arrayBuffer()));
  }
  const actual = createHash("sha256")
    .update(await readFile(new URL(file, root)))
    .digest("hex");
  if (actual !== checksums[file])
    throw Error(
      `Asset checksum mismatch: ${file}. Review the upstream change before updating asset-lock.json.`,
    );
}
console.log("Offline PDF / OCR / font assets are ready.");
