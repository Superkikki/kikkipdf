# GHOST PROTOCOL / BLACK EDITION

起動時に約9秒間流れる、Kikki PDFの隠しオープニング。
シアンの粒子、回転する照準、解読ログ、走査線、ロゴのグリッチとともに編集画面へ移行します。

- **Esc** または **SKIP INTRO** で即スキップ。
- **Ctrl + Shift + K** で再生。入力中とダイアログ表示中は反応しません。
- OSの「視差効果を減らす」設定では、約1秒の静止表示になります。
- 演出中もアプリの初期化は進み、終了後はそのまま編集できます。
- ログとテレメトリーは画面演出です。

検証: `npx playwright test tests/e2e/startup.spec.ts`

録画: `npm run dev` を起動後、別のターミナルで `node scripts/record-startup.mjs` を実行。
`artifacts/ghost-protocol/` にWebM動画とPNGを保存します。

MP4変換:

```sh
ffmpeg -y -i artifacts/ghost-protocol/ghost-protocol.webm -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart artifacts/ghost-protocol/ghost-protocol.mp4
```

Windows用の特別版ビルド（このワークスペースのクロスツールチェーンを使用）:

```sh
bash scripts/build-windows-local.sh --config '{"productName":"Kikki PDF Black Edition"}'
```

ネイティブの保存領域とアプリ識別子は通常版と共通です。
