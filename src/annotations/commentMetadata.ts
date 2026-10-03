import { PDFDict, PDFHexString, PDFName, PDFString } from "pdf-lib";
import type { ReviewStatus } from "../state/model";
const states = new Set<ReviewStatus>(["None", "Accepted", "Rejected", "Cancelled", "Completed"]);
export function writeCommentMetadata(dict: PDFDict, metadata: { author?: string; reviewStatus?: ReviewStatus }) {
  if (metadata.author !== undefined) {
    if (typeof metadata.author !== "string" || metadata.author.length > 10_000) throw Error("コメントの作成者が不正です。");
    dict.set(PDFName.of("T"), PDFHexString.fromText(metadata.author));
  }
  if (metadata.reviewStatus !== undefined) {
    if (!states.has(metadata.reviewStatus) || dict.get(PDFName.of("Subtype")) !== PDFName.of("Text"))
      throw Error("この注釈にはレビュー状態を設定できません。");
    dict.set(PDFName.of("StateModel"), PDFString.of("Review"));
    dict.set(PDFName.of("State"), PDFString.of(metadata.reviewStatus));
  }
}
