import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFObjectCopier,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
} from "pdf-lib";
import type { DocumentModel } from "../state/model";
import {
  attachmentName,
  MAX_ATTACHMENT_BYTES,
  uniqueAttachmentName,
  type AttachmentInfo,
} from "./model";

const key = PDFName.of;
const string = (v: PDFObject | undefined) =>
  v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : "";
interface Entry extends AttachmentInfo {
  spec: PDFDict;
  stream: PDFRawStream;
}

/** Read descriptors without expanding file contents. Includes name trees, AF, and page pins. */
export function attachmentEntries(
  input: PDFDocument,
  sourceId: string,
): Entry[] {
  const entries: Entry[] = [],
    seen = new Map<PDFDict, Entry>();
  function add(value: PDFObject | undefined, name = "", page?: number) {
    const spec = input.context.lookup(value);
    if (!(spec instanceof PDFDict)) return;
    const existing = seen.get(spec);
    if (existing) {
      if (page === undefined) existing.documentLevel = true;
      else if (!existing.pages.includes(page)) existing.pages.push(page);
      return;
    }
    const ef = spec.lookupMaybe(key("EF"), PDFDict),
      stream = input.context.lookup(ef?.get(key("UF")) ?? ef?.get(key("F")));
    if (!(stream instanceof PDFRawStream)) return; // External file references are never followed.
    if (entries.length >= 10000)
      throw Error("添付ファイル数が上限を超えています。");
    const size = stream.dict
      .lookupMaybe(key("Params"), PDFDict)
      ?.lookupMaybe(key("Size"), PDFNumber)
      ?.asNumber();
    const entry: Entry = {
      id: `${sourceId}:attachment-${entries.length}`,
      sourceId,
      name: attachmentName(
        string(spec.get(key("UF"))) || string(spec.get(key("F"))) || name,
      ),
      description: string(spec.get(key("Desc"))),
      size: size !== undefined && size >= 0 ? size : undefined,
      documentLevel: page === undefined,
      pages: page === undefined ? [] : [page],
      spec,
      stream,
    };
    entries.push(entry);
    seen.set(spec, entry);
  }
  const visited = new Set<PDFDict>();
  function walk(node: PDFDict | undefined, depth: number) {
    if (!node || visited.has(node)) return;
    if (depth > 32 || visited.size > 20000)
      throw Error("添付ファイルの名前ツリーが複雑すぎます。");
    visited.add(node);
    const names = node.lookupMaybe(key("Names"), PDFArray);
    if (names)
      for (let i = 0; i + 1 < names.size(); i += 2)
        add(names.get(i + 1), string(names.get(i)));
    const kids = node.lookupMaybe(key("Kids"), PDFArray);
    if (kids)
      for (let i = 0; i < kids.size(); i++)
        walk(kids.lookup(i, PDFDict), depth + 1);
  }
  walk(
    input.catalog
      .lookupMaybe(key("Names"), PDFDict)
      ?.lookupMaybe(key("EmbeddedFiles"), PDFDict),
    0,
  );
  const af = input.catalog.lookupMaybe(key("AF"), PDFArray);
  if (af) for (let i = 0; i < af.size(); i++) add(af.get(i));
  input.getPages().forEach((p, i) => {
    const annotations = p.node.Annots();
    if (annotations)
      for (let j = 0; j < annotations.size(); j++) {
        const a = annotations.lookup(j);
        if (
          a instanceof PDFDict &&
          a.get(key("Subtype")) === key("FileAttachment")
        )
          add(a.get(key("FS")), "", i);
      }
  });
  return entries;
}
export async function inspectAttachments(
  model: Pick<DocumentModel, "sources">,
): Promise<AttachmentInfo[]> {
  const result: AttachmentInfo[] = [];
  for (const source of Object.values(model.sources))
    for (const e of attachmentEntries(
      await PDFDocument.load(source.bytes),
      source.id,
    )) {
      result.push({
        id: e.id,
        sourceId: e.sourceId,
        name: e.name,
        description: e.description,
        size: e.size,
        documentLevel: e.documentLevel,
        pages: e.pages,
      });
    }
  return result;
}
export async function extractAttachment(
  model: Pick<DocumentModel, "sources" | "attachments">,
  id: string,
): Promise<Uint8Array> {
  const added = model.attachments?.find((a) => a.id === id);
  if (added) return added.bytes;
  const source = Object.values(model.sources).find((s) =>
    id.startsWith(`${s.id}:attachment-`),
  );
  if (!source) throw Error("添付元のPDFが見つかりません。");
  const e = attachmentEntries(
    await PDFDocument.load(source.bytes),
    source.id,
  ).find((a) => a.id === id);
  if (!e) throw Error("添付ファイルが見つかりません。");
  if ((e.size ?? 0) > MAX_ATTACHMENT_BYTES)
    throw Error("取り出しは1件128MBまで対応しています。");
  const data = decodePDFRawStream(e.stream).getBytes(MAX_ATTACHMENT_BYTES + 1);
  if (data.length > MAX_ATTACHMENT_BYTES)
    throw Error("添付ファイルの展開サイズが128MBを超えています。");
  return new Uint8Array(data);
}

/** Fresh file specifications, sharing compressed streams. No source page graph or executable action is copied. */
export class AttachmentWriter {
  private names = new Set<string>();
  private records: { name: string; ref: PDFRef }[] = [];
  private specs = new Map<PDFDict, PDFRef>();
  constructor(
    private output: PDFDocument,
    private model: DocumentModel,
    private include = true,
  ) {}
  prepare(input: PDFDocument, sourceId: string) {
    if (!this.include) return;
    const copier = PDFObjectCopier.for(input.context, this.output.context);
    for (const entry of attachmentEntries(input, sourceId)) {
      const edit = this.model.attachmentEdits?.[entry.id];
      if (
        edit?.deleted ||
        (!entry.documentLevel &&
          !this.model.pages.some(
            (p) =>
              p.sourceId === sourceId && entry.pages.includes(p.sourceIndex),
          ))
      )
        continue;
      const dict = input.context.obj({ Type: "EmbeddedFile" });
      for (const name of ["Subtype", "Filter", "DecodeParms", "Length"])
        if (entry.stream.dict.has(key(name)))
          dict.set(key(name), entry.stream.dict.get(key(name))!);
      const params = entry.stream.dict.lookupMaybe(key("Params"), PDFDict);
      if (params) {
        const safe = input.context.obj({});
        for (const name of ["Size", "CheckSum", "CreationDate", "ModDate"]) {
          const value = params.lookup(key(name));
          if (
            value instanceof PDFNumber ||
            value instanceof PDFString ||
            value instanceof PDFHexString
          )
            safe.set(key(name), value);
        }
        dict.set(key("Params"), safe);
      }
      const stream = copier.copy(
        PDFRawStream.of(dict, entry.stream.getContents()),
      );
      const streamRef = this.output.context.register(stream);
      const ref = this.register(
        edit?.name ?? entry.name,
        edit?.description ?? entry.description,
        streamRef,
      );
      this.specs.set(entry.spec, ref);
    }
  }
  /** Rebind page attachment pins; a removed attachment must not survive through /FS. */
  fileSpec(original: PDFDict): PDFRef | undefined {
    const spec = original.lookupMaybe(key("FS"), PDFDict);
    return spec && this.specs.get(spec);
  }
  private register(name: string, description: string, stream: PDFRef) {
    const unique = uniqueAttachmentName(name, this.names),
      spec = this.output.context.obj({
        Type: "Filespec",
        F: PDFHexString.fromText(unique),
        UF: PDFHexString.fromText(unique),
        Desc: PDFHexString.fromText(description),
        EF: { F: stream, UF: stream },
        AFRelationship: "Unspecified",
      }),
      ref = this.output.context.register(spec);
    this.records.push({ name: unique, ref });
    return ref;
  }
  finish() {
    if (!this.include) return;
    for (const a of this.model.attachments ?? []) {
      const edit = this.model.attachmentEdits?.[a.id];
      if (edit?.deleted) continue;
      if (a.bytes.length > MAX_ATTACHMENT_BYTES)
        throw Error("添付ファイルは1件128MBまで対応しています。");
      const stream = this.output.context.flateStream(a.bytes, {
        Type: "EmbeddedFile",
        Params: { Size: a.bytes.length },
      });
      this.register(
        edit?.name ?? a.name,
        edit?.description ?? a.description,
        this.output.context.register(stream),
      );
    }
    if (!this.records.length) return;
    const names =
      this.output.catalog.lookupMaybe(key("Names"), PDFDict) ??
      this.output.context.obj({});
    const entries = this.output.context.obj([]);
    this.records.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const r of this.records) {
      entries.push(PDFHexString.fromText(r.name));
      entries.push(r.ref);
    }
    names.set(
      key("EmbeddedFiles"),
      this.output.context.obj({ Names: entries }),
    );
    this.output.catalog.set(key("Names"), names);
    this.output.catalog.set(
      key("AF"),
      this.output.context.obj(this.records.map((r) => r.ref)),
    );
  }
}
