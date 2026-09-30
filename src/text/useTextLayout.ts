import { useEffect, useState } from "react";
import type { TextLayout, TextStyle } from "./layout";
import { requestTextLayout } from "./client";

export function useTextLayout(style?: TextStyle, preservePrevious = false) {
  const [state, setState] = useState<{
    layout?: TextLayout;
    error?: string;
    key?: string;
  }>({});
  const key = style
    ? JSON.stringify({
        text: style.text,
        width: style.width,
        fontSize: style.fontSize,
        font: style.font,
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
      requestTextLayout(JSON.parse(key) as TextStyle).then(
        (layout) => {
          if (active) setState({ key, layout });
        },
        (error: unknown) => {
          if (active)
            setState({
              key,
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
  }, [key]);
  return state.key === key
    ? { ...state, pending: false }
    : { layout: preservePrevious ? state.layout : undefined, pending: true };
}
