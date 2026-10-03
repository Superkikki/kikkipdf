const { PDFDocument, StandardFonts, PDFName, PDFDict, PDFHexString, PDFString } = require("pdf-lib");
const { writeFile, readFile } = require("node:fs/promises");
(async () => {
  if (process.argv[3] === "bookmarks") {
    const pdf = await PDFDocument.create(); pdf.addPage([420, 595]);
    const b = pdf.addPage([420, 595]), context = pdf.context;
    const outline = context.obj({ Type: "Outlines", Count: 1 }), root = context.obj({ Title: PDFHexString.fromText("Root"), Count: -2 }), branch = context.obj({ Title: PDFHexString.fromText("Closed chapter"), Count: -1 }), leaf = context.obj({ Title: PDFHexString.fromText("Needle"), Dest: [b.ref, "Fit"] }), other = context.obj({ Title: PDFHexString.fromText("Other"), A: { S: "URI", URI: PDFString.of("https://example.com/native") } });
    const outlineRef = context.register(outline), rootRef = context.register(root), branchRef = context.register(branch), leafRef = context.register(leaf), otherRef = context.register(other);
    outline.set(PDFName.of("First"), rootRef); outline.set(PDFName.of("Last"), rootRef); root.set(PDFName.of("Parent"), outlineRef);
    root.set(PDFName.of("First"), branchRef); root.set(PDFName.of("Last"), otherRef);
    branch.set(PDFName.of("Parent"), rootRef); branch.set(PDFName.of("Next"), otherRef); branch.set(PDFName.of("First"), leafRef); branch.set(PDFName.of("Last"), leafRef);
    leaf.set(PDFName.of("Parent"), branchRef); other.set(PDFName.of("Parent"), rootRef); other.set(PDFName.of("Prev"), branchRef);
    pdf.catalog.set(PDFName.of("Outlines"), outlineRef); await writeFile(process.argv[2], await pdf.save()); return;
  }
  if (process.argv[3] === "choices") {
    const pdf = await PDFDocument.create(),
      page = pdf.addPage([420, 595]);
    for (const kind of ["dropdown", "list"]) {
      const field =
        kind === "dropdown"
          ? pdf.getForm().createDropdown("ColorCode")
          : pdf.getForm().createOptionList("TagCode");
      field.setOptions(["Red", "Green", "Blue"]);
      field.addToPage(page, {
        x: 40,
        y: kind === "dropdown" ? 470 : 300,
        width: 220,
        height: 80,
      });
      if (kind === "list") field.enableMultiselect();
      field.acroField.setOptions(
        ["Red", "Green", "Blue"].map((label) => ({
          value: PDFHexString.fromText(label[0]),
          display: PDFHexString.fromText(label),
        })),
      );
      field.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText("G"));
    }
    await writeFile(
      process.argv[2],
      await pdf.save({ updateFieldAppearances: false }),
    );
    return;
  }
  if (process.argv[3] === "vertical") {
    const pdf = await PDFDocument.create(); pdf.registerFontkit(require("@pdf-lib/fontkit"));
    const p = pdf.addPage([420, 595]);
    const font = await pdf.embedFont(await readFile(require("node:path").join(__dirname, "..", "public", "assets", "NotoSansJP-Regular.otf")), { subset: false });
    const first = font.encodeText("日本語の縦書き").toString(), second = font.encodeText("隣の列").toString();
    await pdf.flush();
    pdf.context.lookup(font.ref, PDFDict).set(PDFName.of("Encoding"), PDFName.of("Identity-V"));
    p.node.set(PDFName.of("Resources"), pdf.context.obj({ Font: { F1: font.ref } }));
    p.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(`BT /F1 20 Tf 1 0 0 1 300 520 Tm ${first} Tj 1 0 0 1 260 520 Tm ${second} Tj ET`)));
    await writeFile(process.argv[2], await pdf.save()); return;
  }
  if (["form", "images"].includes(process.argv[3])) {
    const inner = await PDFDocument.create(), p = inner.addPage([420, 595]);
    const font = await inner.embedFont(StandardFonts.Helvetica), neighbour = await inner.embedFont(StandardFonts.TimesRoman);
    if (process.argv[3] === "images") {
      const image = await inner.embedPng(await readFile(require("node:path").join(__dirname, "..", "src-tauri", "icons", "32x32.png")));
      p.drawImage(image, { x: 40, y: 420, width: 80, height: 40 });
      await inner.flush();
      inner.context.lookup(image.ref).dict.set(PDFName.of("ColorSpace"), PDFName.of("SharedRGB"));
      p.node.Resources().set(PDFName.of("ColorSpace"), inner.context.obj({ SharedRGB: "DeviceRGB" }));
      p.drawText("Native image neighbour", { x: 40, y: 520, size: 18, font });
    } else {
      p.drawText("Native Form original", { x: 40, y: 520, size: 18, font });
      p.drawText("Neighbour", { x: 230, y: 520, size: 18, font: neighbour });
    }
    const loaded = await PDFDocument.load(await inner.save()), middle = await PDFDocument.create();
    middle.addPage([420, 595]).drawPage(await middle.embedPage(loaded.getPage(0)));
    const source = await PDFDocument.load(await middle.save()), pdf = await PDFDocument.create();
    const outer = pdf.addPage([420, 595]), embedded = await pdf.embedPage(source.getPage(0));
    outer.drawPage(embedded); outer.drawPage(embedded, { y: -180 });
    await writeFile(process.argv[2], await pdf.save());
    return;
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    pdf.addPage([420, 595]).drawText(`Native Windows fixture ${i}`, {
      x: 40,
      y: 550,
      size: 14,
      font,
    });
  }
  const existing = pdf.getForm().createTextField("NativeOriginal");
  existing.addToPage(pdf.getPage(0), {
    x: 260,
    y: 450,
    width: 110,
    height: 25,
  });
  existing.setText("Original field");
  await pdf.attach(
    Buffer.from("Native attachment round trip", "utf8"),
    "native-note.txt",
    { description: "Native smoke attachment" },
  );
  await writeFile(process.argv[2], await pdf.save());
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
