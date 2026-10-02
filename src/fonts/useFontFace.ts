import { useEffect, useState } from "react";
import type { FontAsset } from "../state/model";
import { customFontFamily } from "../text/fonts";
const faces = new Map<
  string,
  { face: FontFace; promise: Promise<FontFace>; users: number }
>();
/** Temporary faces belong to visible objects; last unmount removes the face. */
export function useFontFace(asset?: FontAsset) {
  const [state, setState] = useState<{ id: string; error?: string }>();
  useEffect(() => {
    if (!asset) return;
    let entry = faces.get(asset.id);
    if (!entry) {
      const face = new FontFace(
        customFontFamily(asset.id),
        new Uint8Array(asset.bytes).buffer,
      );
      document.fonts.add(face);
      entry = { face, promise: face.load(), users: 0 };
      faces.set(asset.id, entry);
    }
    entry.users++;
    let active = true;
    entry.promise.then(
      () => {
        if (active) setState({ id: asset.id });
      },
      () => {
        if (active)
          setState({
            id: asset.id,
            error: "フォントの表示用データを読み込めません。",
          });
      },
    );
    return () => {
      active = false;
      if (entry && --entry.users === 0) {
        document.fonts.delete(entry.face);
        faces.delete(asset.id);
      }
    };
  }, [asset]);
  return {
    ready: !asset || (state?.id === asset.id && !state.error),
    error: state?.id === asset?.id ? state?.error : undefined,
  };
}
