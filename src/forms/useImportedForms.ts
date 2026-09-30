import { useEffect, useState } from "react";
import type { DocumentModel } from "../state/model";
import type { FormDescriptor } from "../export/engine";
import { loadForms } from "../export/client";

// A shared source snapshot is inspected once, in a Worker. Weak keys release
// the cache when a document closes; visible page views never copy it per page.
const cache = new WeakMap<
  DocumentModel["sources"],
  Promise<FormDescriptor[]>
>();
export function useImportedForms(
  sources: DocumentModel["sources"],
  enabled = true,
) {
  const [state, setState] = useState<{
    sources?: DocumentModel["sources"];
    fields: FormDescriptor[];
    error?: string;
  }>({ fields: [] });
  useEffect(() => {
    if (!enabled || !Object.keys(sources).length) return;
    let live = true;
    let request = cache.get(sources);
    if (!request) {
      request = loadForms({ sources });
      cache.set(sources, request);
      request.catch(() => cache.delete(sources));
    }
    request.then(
      (fields) => {
        if (live) setState({ sources, fields });
      },
      () => {
        if (live)
          setState({
            sources,
            fields: [],
            error: "フォームを読み込めません。XFAフォームは未対応です。",
          });
      },
    );
    return () => {
      live = false;
    };
  }, [sources, enabled]);
  return state.sources === sources
    ? { ...state, loading: false }
    : { fields: [], loading: enabled && !!Object.keys(sources).length };
}
