import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
export async function type3Fixture(options: { matrix?: number[]; width?: number; charWidth?: number; noProcedure?: boolean; name?: string; unicode?: string; charProgram?: string; noFirst?: boolean; last?: number } = {}) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([420, 400]), context = pdf.context;
  const glyphA = context.register(context.flateStream(options.charProgram ?? `${options.charWidth ?? 500} 0 0 0 500 700 d1 0 0 500 700 re f`));
  const glyphB = context.register(context.flateStream("600 0 d0 0 0 600 700 re f"));
  const encodingName = options.name ?? "A";
  const font = context.register(context.obj({ Type: "Font", Subtype: "Type3", Name: "F3", FontBBox: [0, 0, 600, 700],
    FontMatrix: options.matrix ?? [0.001, 0, 0, 0.001, 0, 0], ...(!options.noFirst ? { FirstChar: 65 } : {}), LastChar: options.last ?? 66, Widths: [options.width ?? 500, 600],
    Encoding: { Differences: [65, encodingName, "B"] }, CharProcs: { ...(!options.noProcedure ? { [encodingName]: glyphA } : {}), B: glyphB }, Resources: {},
    ...(options.unicode ? { ToUnicode: context.register(context.flateStream(options.unicode)) } : {}),
  }));
  const neighbour = await pdf.embedFont(StandardFonts.Helvetica);
  page.node.set(PDFName.of("Resources"), context.obj({ Font: { F3: font, F2: neighbour.ref } }));
  page.node.set(PDFName.of("Contents"), context.register(context.flateStream("BT /F3 20 Tf 1 0 0 1 40 300 Tm (A) Tj (B) Tj /F2 20 Tf ( Neighbour) Tj ET")));
  return pdf.save();
}
