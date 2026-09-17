import type { FormFieldModel } from "../state/model";
import { documentStore } from "../state/store";
import { updateFormField } from "./commands";
export function FormOverlay({
  fields,
  thumbnail,
}: {
  fields: FormFieldModel[];
  thumbnail: boolean;
}) {
  return (
    <div className="form-page-overlay">
      {fields.map((f) => (
        <div
          className="form-widget"
          key={f.id}
          style={{
            left: f.x,
            top: f.y,
            width: f.width,
            height: f.height,
            fontSize: f.fontSize,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          title={f.name}
        >
          {thumbnail ? (
            <span>{f.name}</span>
          ) : f.kind === "text" ? (
            f.multiline ? (
              <textarea
                aria-label={f.name}
                readOnly={f.readOnly}
                maxLength={f.maxLength}
                value={String(f.value)}
                rows={f.multiline ? 3 : 1}
                onChange={(e) =>
                  documentStore.execute(
                    updateFormField(f.id, { value: e.target.value }),
                  )
                }
              />
            ) : (
              <input
                aria-label={f.name}
                readOnly={f.readOnly}
                maxLength={f.maxLength}
                value={String(f.value)}
                onChange={(e) =>
                  documentStore.execute(
                    updateFormField(f.id, { value: e.target.value }),
                  )
                }
              />
            )
          ) : f.kind === "checkbox" ? (
            <input
              aria-label={f.name}
              type="checkbox"
              disabled={f.readOnly}
              checked={Boolean(f.value)}
              onChange={(e) =>
                documentStore.execute(
                  updateFormField(f.id, { value: e.target.checked }),
                )
              }
            />
          ) : f.kind === "radio" ? (
            <div>
              {f.options.map((option) => (
                <label key={option}>
                  <input
                    type="radio"
                    name={f.id}
                    checked={f.value === option}
                    disabled={f.readOnly}
                    onChange={() =>
                      documentStore.execute(
                        updateFormField(f.id, { value: option }),
                      )
                    }
                  />
                  {option}
                </label>
              ))}
            </div>
          ) : (
            <select
              aria-label={f.name}
              disabled={f.readOnly}
              multiple={f.multiSelect}
              size={f.kind === "list" || f.multiSelect ? 3 : 1}
              value={
                f.multiSelect
                  ? Array.isArray(f.value)
                    ? f.value
                    : f.value
                      ? [String(f.value)]
                      : []
                  : Array.isArray(f.value)
                    ? (f.value[0] ?? "")
                    : String(f.value)
              }
              onChange={(e) =>
                documentStore.execute(
                  updateFormField(f.id, {
                    value: f.multiSelect
                      ? Array.from(e.target.selectedOptions).map((o) => o.value)
                      : e.target.value,
                  }),
                )
              }
            >
              {!f.multiSelect && <option value="" />}
              {f.options.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}
