const { PDFDocument, StandardFonts } = require("pdf-lib");
const { writeFile } = require("node:fs/promises");
(async () => {
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
