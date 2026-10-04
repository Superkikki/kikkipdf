export const INLINE_TEXT_COMMIT = "kikki:commit-inline-text";

/** Commit the visible draft before an operation reads or replaces the document. */
export function flushInlineText() {
  return window.dispatchEvent(new Event(INLINE_TEXT_COMMIT, { cancelable: true }));
}
