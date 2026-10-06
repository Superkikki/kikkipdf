import type {
  SourceTextReference,
  SourceImageReference,
} from "../direct/model";
export type ObjectKind =
  | "direct-text"
  | "direct-image"
  | "text"
  | "image"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "ink"
  | "highlight"
  | "underline"
  | "strike"
  | "note"
  | "redaction"
  | "link"
  | "replacement"
  | "ocr";
export type LinkTarget =
  | { kind: "page"; pageId: string }
  | { kind: "url"; url: string };
export type ReviewStatus = "None" | "Accepted" | "Rejected" | "Cancelled" | "Completed";
export interface AnnotationEdit {
  text?: string;
  author?: string;
  reviewStatus?: ReviewStatus;
  deleted?: boolean;
  link?: LinkTarget;
  /** Link rectangle relative to the original CropBox, before page rotation. */
  box?: Box;
}
export interface Point {
  x: number;
  y: number;
}
export interface Box extends Point {
  width: number;
  height: number;
}
/** XFDF geometry relative to the original CropBox, before editing crop/rotation. */
export interface ImportedMarkup extends Box {
  id: string;
  subtype: "Text" | "Highlight" | "Underline" | "StrikeOut" | "Ink";
  name?: string;
  text: string;
  author: string;
  reviewStatus: ReviewStatus;
  color: string | null;
  opacity: number;
  strokeWidth: number;
  quadPoints?: Point[];
  gestures?: Point[][];
  icon?: string;
  date?: string;
  creationDate?: string;
  subject?: string;
  flags?: number;
}
export interface EditObject extends Box {
  id: string;
  kind: ObjectKind;
  color: string;
  fill: string;
  opacity: number;
  strokeWidth: number;
  text?: string;
  author?: string;
  reviewStatus?: ReviewStatus;
  textStrokeWidth?: number;
  textStrokeColor?: string;
  textOutlineOnly?: boolean;
  fontSize: number;
  font: "sans" | "serif" | "mono" | "japanese" | "custom";
  fontId?: string;
  sourceText?: SourceTextReference;
  sourceImage?: SourceImageReference;
  imageDeleted?: boolean;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  rotation: number;
  imageId?: string;
  points?: Point[];
  link?: LinkTarget;
  ocrConfidence?: number;
  ocrReviewed?: boolean;
  wrap?: boolean;
  lineHeight?: number;
  writingMode?: "vertical";
}
export interface PageModel {
  id: string;
  /** Logical PDF page label, kept with this page during page operations. */
  label?: string;
  sourceId?: string;
  sourceIndex: number;
  width: number;
  height: number;
  rotation: number;
  objects: EditObject[];
  annotationEdits?: Record<string, AnnotationEdit>;
  importedMarkups?: ImportedMarkup[];
  /** Widget identities refer to the immutable source PDF, scoped to this page. */
  formWidgetEdits?: Record<string, Box>;
  crop?: Box;
}
export interface Source {
  id: string;
  name: string;
  bytes: Uint8Array;
  /** User visibility overrides, scoped to original PDF optional-content refs. */
  layerVisibility?: Record<string, boolean>;
  layerNames?: Record<string, string>;
}
export interface ImageAsset {
  id: string;
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
}
export interface FontAsset {
  id: string;
  name: string;
  family: string;
  format: "ttf" | "otf";
  bytes: Uint8Array;
}
export interface AttachmentAsset {
  id: string;
  name: string;
  description: string;
  bytes: Uint8Array;
}
export interface AttachmentEdit {
  name?: string;
  description?: string;
  deleted?: boolean;
}
export interface Metadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
}
export type FieldValue = string | boolean | string[];
export type FormKind = "text" | "checkbox" | "radio" | "dropdown" | "list";
export interface ChoiceOption {
  value: string;
  label: string;
}
export interface ImportedFormEdit {
  name?: string;
  required?: boolean;
  readOnly?: boolean;
  multiline?: boolean;
  multiSelect?: boolean;
  /** null explicitly removes the original maximum length. */
  maxLength?: number | null;
  options?: string[];
  choiceOptions?: ChoiceOption[];
}
export interface FormFieldModel extends Box {
  id: string;
  pageId: string;
  name: string;
  kind: FormKind;
  value: FieldValue;
  options: string[];
  choiceOptions?: ChoiceOption[];
  fontSize: number;
  required: boolean;
  readOnly: boolean;
  multiline: boolean;
  multiSelect?: boolean;
  maxLength?: number;
}
export type BookmarkDestination =
  | { kind: "XYZ"; left: number | null; top: number | null; zoom: number | null }
  | { kind: "Fit" | "FitB" }
  | { kind: "FitH" | "FitBH"; top: number | null }
  | { kind: "FitV" | "FitBV"; left: number | null }
  | { kind: "FitR"; left: number; bottom: number; right: number; top: number };
export interface BookmarkModel {
  id: string;
  title: string;
  pageId?: string;
  /** Coordinates and zoom in the PDF destination's original user space. */
  destination?: BookmarkDestination;
  url?: string;
  expanded?: boolean;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  children: BookmarkModel[];
}
export interface DocumentModel {
  id: string;
  name: string;
  path?: string;
  sources: Record<string, Source>;
  images: Record<string, ImageAsset>;
  fonts?: Record<string, FontAsset>;
  attachments?: AttachmentAsset[];
  attachmentEdits?: Record<string, AttachmentEdit>;
  pages: PageModel[];
  metadata: Metadata;
  formValues: Record<string, FieldValue>;
  /** Keys retain the immutable source field name even after a rename. */
  importedFormEdits?: Record<string, ImportedFormEdit>;
  formFields?: FormFieldModel[];
  flattenForms?: boolean;
  bookmarks?: BookmarkModel[];
  created: number;
}
export const uid = () => crypto.randomUUID();
export const emptyDocument = (name = "無題.pdf"): DocumentModel => ({
  id: uid(),
  name,
  sources: {},
  images: {},
  pages: [],
  metadata: { title: "", author: "", subject: "", keywords: "" },
  formValues: {},
  created: Date.now(),
});
export const blankPage = (): PageModel => ({
  id: uid(),
  sourceIndex: 0,
  width: 595.28,
  height: 841.89,
  rotation: 0,
  objects: [],
});
export function newObject(kind: ObjectKind, x: number, y: number): EditObject {
  return {
    id: uid(),
    kind,
    x,
    y,
    width: kind === "text" ? 220 : 120,
    height: kind === "text" ? 36 : 70,
    color: "#263445",
    fill: "none",
    opacity: kind === "highlight" ? 0.35 : 1,
    strokeWidth: 2,
    fontSize: 18,
    font: "japanese",
    bold: false,
    italic: false,
    align: "left",
    rotation: 0,
    ...(kind === "text" ? { wrap: true, lineHeight: 1.25 } : {}),
    ...(kind === "highlight" ? { color: "#ffce32", fill: "#ffce32" } : {}),
    ...(kind === "text" || kind === "replacement" ? { text: "テキスト" } : {}),
    ...(kind === "note"
      ? { text: "コメント", width: 24, height: 24, fill: "#ffce32" }
      : {}),
  };
}
export function pageSize(p: PageModel) {
  const w = p.crop?.width ?? p.width,
    h = p.crop?.height ?? p.height;
  return p.rotation % 180 === 0
    ? { width: w, height: h }
    : { width: h, height: w };
}
