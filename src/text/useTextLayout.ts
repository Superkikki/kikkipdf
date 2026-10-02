import { useEffect, useState } from "react";
import type { TextLayout, TextStyle } from "./layout";
import { requestTextLayout } from "./client";
import type { FontAsset } from "../state/model";

export function useTextLayout(
  style?: TextStyle,
  preservePrevious = false,
  asset?: FontAsset,
) {
  const [state, setState] = useState<{
    layout?: TextLayout;
    error?: string;
    key?: string;
    family?: string;
  }>({});
  const family = style
    ? `${style.font}:${style.fontId}:${style.bold}:${style.italic}`
    : undefined;
  const key = style
    ? JSON.stringify({
        text: style.text,
        width: style.width,
        fontSize: style.fontSize,
        font: style.font,
        fontId: style.fontId,
        bold: style.bold,
        italic: style.italic,
        wrap: style.wrap,
        lineHeight: style.lineHeight,
      })
    : undefined;
  useEffect(() => {
    if (!key) return;
    let active = true;
    // Debounce typing and resize previews; the worker only receives style/text,
    // never the source PDFs, images, or undo history.
    const timeout = setTimeout(() => {
      requestTextLayout(JSON.parse(key) as TextStyle, asset).then(
        (layout) => {
          if (active) setState({ key, family, layout });
        },
        (error: unknown) => {
          if (active)
            setState({
              key,
              family,
              error:
                error instanceof Error
                  ? error.message
                  : "レイアウトに失敗しました。",
            });
        },
      );
    }, 80);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [key, asset, family]);
  return state.key === key
    ? { ...state, pending: false }
    : {
        layout:
          preservePrevious && family === state.family
            ? state.layout
            : undefined,
        pending: true,
      };
}
