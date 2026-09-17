import { useState, useCallback } from "react";
import { Dialog } from "./Dialog";
export interface PromptOptions {
  title: string;
  message?: string;
  confirm?: string;
  danger?: boolean;
  fields?: {
    key: string;
    label: string;
    value?: string;
    type?: "text" | "password" | "number" | "color";
    options?: string[];
  }[];
}
export function usePrompt() {
  const [pending, setPending] = useState<{
    options: PromptOptions;
    resolve: (v: Record<string, string> | null) => void;
  } | null>(null);
  const ask = useCallback(
    (options: PromptOptions) =>
      new Promise<Record<string, string> | null>((resolve) =>
        setPending({ options, resolve }),
      ),
    [],
  );
  const finish = (v: Record<string, string> | null) => {
    pending?.resolve(v);
    setPending(null);
  };
  return {
    ask,
    dialog: pending ? (
      <PromptForm
        key={pending.options.title}
        options={pending.options}
        finish={finish}
      />
    ) : null,
  };
}
function PromptForm({
  options,
  finish,
}: {
  options: PromptOptions;
  finish: (v: Record<string, string> | null) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      (options.fields ?? []).map((f) => [f.key, f.value ?? ""]),
    ),
  );
  return (
    <Dialog title={options.title} onClose={() => finish(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          finish(values);
        }}
      >
        <div className="dialog-body">
          {options.message && (
            <p className={options.danger ? "warning" : "notice"}>
              {options.message}
            </p>
          )}
          {options.fields?.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.options ? (
                <select
                  aria-label={f.label}
                  value={values[f.key]}
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.value })
                  }
                >
                  {f.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  autoComplete="off"
                  aria-label={f.label}
                  type={f.type ?? "text"}
                  value={values[f.key]}
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.value })
                  }
                />
              )}
            </label>
          ))}
        </div>
        <footer>
          <button type="button" onClick={() => finish(null)}>
            キャンセル
          </button>
          <button
            className={options.danger ? "danger primary" : "primary"}
            type="submit"
          >
            {options.confirm ?? "適用"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
