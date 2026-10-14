export const DOCUMENT_NAME_COMMIT = "kikki:commit-document-name";

/** Save must read the current name draft, and stop if it cannot be committed. */
export function flushDocumentName() {
  return window.dispatchEvent(new Event(DOCUMENT_NAME_COMMIT, { cancelable: true }));
}
