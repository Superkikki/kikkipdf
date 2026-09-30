import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
await mkdir("LICENSES/npm", { recursive: true });
await mkdir("LICENSES/rust", { recursive: true });
let out =
  "# Third-party notices\n\nKikki PDF includes the following open-source components. Application source licensing is not granted by these third-party notices.\n\n## JavaScript runtime dependencies\n\n| Package | Version | License |\n|---|---|---|\n";
for (const [loc, info] of Object.entries(lock.packages)) {
  if (!loc || info.dev || !info.version) continue;
  let pkg;
  try {
    pkg = JSON.parse(await readFile(path.join(loc, "package.json"), "utf8"));
  } catch {
    continue;
  }
  out += `| ${pkg.name} | ${pkg.version} | ${pkg.license ?? "See license file"} |\n`;
  const dest = path.join("LICENSES/npm", pkg.name.replaceAll("/", "__"));
  await mkdir(dest, { recursive: true });
  for (const f of await readdir(loc)) {
    if (/^(license|notice|copying)/i.test(f)) {
      try {
        await copyFile(path.join(loc, f), path.join(dest, f));
      } catch {
        /* directories are described by package manifest */
      }
    }
  }
}
const meta = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--format-version",
      "1",
      "--offline",
    ],
    { maxBuffer: 30e6, encoding: "utf8" },
  ),
);
out +=
  "\n## Rust dependencies (including platform-specific/build dependencies)\n\n| Crate | Version | License |\n|---|---|---|\n";
for (const p of meta.packages) {
  if (p.name === "kikki-pdf") continue;
  out += `| ${p.name} | ${p.version} | ${p.license ?? "See license file"} |\n`;
  const dir = path.dirname(p.manifest_path),
    dest = path.join("LICENSES/rust", p.name + "-" + p.version);
  await mkdir(dest, { recursive: true });
  for (const f of await readdir(dir)) {
    if (/^(license|notice|copying)/i.test(f)) {
      try {
        await copyFile(path.join(dir, f), path.join(dest, f));
      } catch {
        /* directory */
      }
    }
  }
}
out +=
  "\n## Bundled assets and tools\n\n- Noto Sans JP: Copyright the Noto Project Authors, SIL Open Font License 1.1. See LICENSES/NotoSansJP-OFL.txt.\n- Tesseract eng/jpn tessdata_fast: Apache-2.0, https://github.com/tesseract-ocr/tessdata_fast.\n- Tesseract.js / Tesseract / Leptonica WebAssembly: Apache-2.0 / Apache-2.0 / BSD-2-Clause. See LICENSES/ocr and the bundled tesseract.js-core license. Image codecs and OpenLibm are also included; their original notices and source revisions are in LICENSES/ocr.\n- PDF.js includes core-js (MIT), fonts, CMaps and OpenJPEG/QCMS WebAssembly; upstream notices are preserved under LICENSES/pdfjs-assets.\n- Lucide icons: ISC. Kikki application mark is an original geometric drawing.\n- NSIS installer: zlib/libpng license; nsis-tauri-utils MIT or Apache-2.0.\n- WebView2Loader.dll: Microsoft WebView2 SDK terms, included by webview2-com-sys (statically linked in the MSVC build). See LICENSES/WebView2-LICENSE.txt. WebView2 Runtime is a Microsoft prerequisite, not an OSS PDF component.\n- Build-only GCC/MinGW/binutils are external toolchain components; this repository does not distribute their binaries as part of the app. The final installer uses MSVC. NSIS and auxiliary GNU toolchain notices are in LICENSES/toolchain.\n\n## Development tools\n\nReact/TypeScript/Vite/Vitest/ESLint/Playwright/Tauri CLI licenses are available in their npm/crate distributions. Exact resolved versions are in package-lock.json and Cargo.lock.\n";
out = out.replace(
  "Noto Sans JP: Copyright the Noto Project Authors, SIL Open Font License 1.1. See LICENSES/NotoSansJP-OFL.txt.",
  "Noto Sans JP static Regular 2.004: Copyright © 2014–2021 Adobe, SIL Open Font License 1.1. See LICENSES/NotoSansJP-OFL.txt and LICENSES/NotoSansJP-SOURCE.md for the original Noto CJK release and checksum.",
);
await writeFile("THIRD_PARTY_NOTICES.md", out);
await copyFile(
  "public/assets/NotoSansJP-static-OFL.txt",
  "LICENSES/NotoSansJP-OFL.txt",
);
for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
  const src = "node_modules/pdfjs-dist/" + dir;
  const dest = "LICENSES/pdfjs-assets/" + dir;
  await mkdir(dest, { recursive: true });
  for (const f of await readdir(src)) {
    if (/license|notice/i.test(f))
      await copyFile(path.join(src, f), path.join(dest, f));
  }
}
console.log("Third-party notices generated.");
