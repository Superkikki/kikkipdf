import { useEffect, useRef, useState } from "react";
import { layerConfig } from "../layers/model";
import { sourcePdf } from "../viewer/pdf";
import type {
  Box,
  DocumentModel,
  FormFieldModel,
  PageModel,
  Point,
} from "../state/model";
import { documentStore } from "../state/store";
import { change } from "../commands/document";
import { screenToPage } from "../viewer/coordinates";
import { useImportedForms } from "./useImportedForms";
import { updateFormWidget } from "./commands";
import { FormOverlay } from "./FormOverlay";
import { resolveImportedForm } from "./importedSettings";

export interface FormEditSelection {
  widgetId: string;
  select: (id: string) => void;
}
export function ImportedFormOverlay({
  model,
  page,
  enabled,
  thumbnail,
  edit,
}: {
  model: DocumentModel;
  page: PageModel;
  enabled: boolean;
  thumbnail: boolean;
  edit?: FormEditSelection;
}) {
  const { fields } = useImportedForms(model.sources, enabled);
  const source = page.sourceId ? model.sources[page.sourceId] : undefined;
  const [visibility, setVisibility] = useState<{
    source: typeof source;
    config: Awaited<ReturnType<typeof layerConfig>>;
  }>();
  useEffect(() => {
    if (!source || !enabled) return;
    let live = true;
    void sourcePdf(source).then((pdf) => layerConfig(pdf, source.layerVisibility)).then((config) => {
      if (live) setVisibility({ source, config });
    }).catch(() => {});
    return () => { live = false; };
  }, [source, enabled]);
  const [draft, setDraft] = useState<{ id: string; box: Box }>();
  const gesture = useRef<
    | {
        id: string;
        start: Point;
        box: Box;
        resize: boolean;
      }
    | undefined
  >(undefined);
  const widgets = fields
    .map((f) => resolveImportedForm(f, model))
    .filter((f) => f.sourceId === page.sourceId)
    .flatMap((field) =>
      field.widgets
        .filter((w) => w.pageIndex === page.sourceIndex && (!w.optionalContent ||
          (visibility && visibility.source === source && visibility.config.isVisible(w.optionalContent))))
        .map((widget) => ({
          field,
          widget,
          box: page.formWidgetEdits?.[widget.id] ?? widget,
        })),
    );
  const point = (event: React.PointerEvent): Point => {
    const bounds = event.currentTarget
      .closest(".page-content")!
      .getBoundingClientRect();
    const scale =
      bounds.width / (page.rotation % 180 ? page.height : page.width);
    return screenToPage(
      { x: event.clientX - bounds.x, y: event.clientY - bounds.y },
      page.width,
      page.height,
      page.rotation,
      scale,
    );
  };
  if (edit)
    return (
      <div className="form-page-overlay imported-form-design">
        {widgets.map(({ field, widget, box }) => {
          const current = draft?.id === widget.id ? draft.box : box;
          return (
            <div
              key={widget.id}
              data-widget-id={widget.id}
              className={`form-edit-widget ${edit.widgetId === widget.id ? "selected" : ""}`}
              style={{
                left: current.x,
                top: current.y,
                width: current.width,
                height: current.height,
              }}
              role="button"
              tabIndex={0}
              aria-label={`配置を編集 ${field.name}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  edit.select(widget.id);
                }
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                e.currentTarget.focus();
                edit.select(widget.id);
                e.currentTarget.setPointerCapture(e.pointerId);
                gesture.current = {
                  id: widget.id,
                  box: {
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                  },
                  start: point(e),
                  resize: (e.target as HTMLElement).classList.contains(
                    "form-resize-handle",
                  ),
                };
              }}
              onPointerMove={(e) => {
                const g = gesture.current;
                if (!g || g.id !== widget.id) return;
                const p = point(e),
                  dx = p.x - g.start.x,
                  dy = p.y - g.start.y;
                const box = g.resize
                  ? {
                      ...g.box,
                      width: Math.max(
                        1,
                        Math.min(page.width - g.box.x, g.box.width + dx),
                      ),
                      height: Math.max(
                        1,
                        Math.min(page.height - g.box.y, g.box.height + dy),
                      ),
                    }
                  : {
                      ...g.box,
                      x: Math.max(
                        0,
                        Math.min(
                          Math.max(0, page.width - g.box.width),
                          g.box.x + dx,
                        ),
                      ),
                      y: Math.max(
                        0,
                        Math.min(
                          Math.max(0, page.height - g.box.height),
                          g.box.y + dy,
                        ),
                      ),
                    };
                setDraft({ id: widget.id, box });
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                if (gesture.current && draft?.id === widget.id)
                  documentStore.execute(
                    updateFormWidget(page.id, widget.id, draft.box),
                  );
                gesture.current = undefined;
                setDraft(undefined);
              }}
              onPointerCancel={() => {
                gesture.current = undefined;
                setDraft(undefined);
              }}
            >
              <span>{field.name}</span>
              {edit.widgetId === widget.id && (
                <span className="form-resize-handle" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    );
  const controls: FormFieldModel[] = widgets.map(({ field, widget, box }) => ({
    ...box,
    id: widget.id,
    pageId: page.id,
    name: field.name,
    kind: field.kind,
    value: field.value,
    choiceOptions: field.choiceOptions,
    options: field.kind === "radio" ? [widget.option ?? ""] : field.options,
    fontSize: field.fontSize,
    required: !!field.required,
    readOnly: !!field.readOnly,
    multiline: !!field.multiline,
    multiSelect: field.multiSelect,
    maxLength: field.maxLength,
  }));
  return (
    <div className="imported-form-controls">
      <FormOverlay
        fields={controls}
        thumbnail={thumbnail}
        onValue={(id, value) => {
          const field = widgets.find((w) => w.widget.id === id)?.field;
          if (field)
            documentStore.execute(
              change("既存フォーム入力", (d) => ({
                ...d,
                formValues: { ...d.formValues, [field.key]: value },
              })),
            );
        }}
      />
    </div>
  );
}
