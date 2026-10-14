import { useEffect, useId, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { DOCUMENT_NAME_COMMIT } from "../editor/flushDocumentName";

export function DocumentName({ name, autoEdit, disabled, rename }: {
  name: string;
  autoEdit: boolean;
  disabled: boolean;
  rename: (value: string) => boolean;
}) {
  const [editing, setEditing] = useState(autoEdit);
  const [value, setValue] = useState(name.replace(/\.pdf$/i, ""));
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const composing = useRef(false);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (!editing) return;
    function commit(e: Event) {
      if (composing.current) { e.preventDefault(); return; }
      try {
        if (!rename(value)) { e.preventDefault(); return; }
        setEditing(false);
      } catch (error) {
        e.preventDefault();
        setError(error instanceof Error ? error.message : String(error));
        input.current?.focus();
      }
    }
    window.addEventListener(DOCUMENT_NAME_COMMIT, commit);
    return () => window.removeEventListener(DOCUMENT_NAME_COMMIT, commit);
  }, [editing, value, rename]);
  function finish() {
    setEditing(false);
    requestAnimationFrame(() => button.current?.focus());
  }
  if (!editing) return (
    <button ref={button} className="document-name" disabled={disabled}
      aria-label="文書の名前を変更" title={`${name} — クリックして名前を変更（F2）`}
      onClick={() => { setValue(name.replace(/\.pdf$/i, "")); setError(""); setEditing(true); }}>
      <strong>{name}</strong><Pencil size={13} /><span className="rename-label">名前を変更</span>
    </button>
  );
  return (
    <form className="document-name-editor" onSubmit={(e) => {
      e.preventDefault();
      try { if (rename(value)) finish(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); input.current?.focus(); }
    }} onKeyDown={(e) => {
      if (e.key === "Escape" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); finish(); }
      if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault();
    }}>
      <input ref={input} aria-label="文書のファイル名" aria-describedby={hintId} aria-invalid={!!error}
        value={value} disabled={disabled} autoComplete="off" spellCheck={false}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onChange={(e) => { setValue(e.target.value); setError(""); }} />
      <span className="document-name-extension">.pdf</span>
      <button type="submit" disabled={disabled || !value.trim()} title="名前を確定（Enter）" aria-label="名前を確定"><Check size={16} /></button>
      <button type="button" disabled={disabled} title="名前の変更を取消（Esc）" aria-label="名前の変更を取消" onClick={finish}><X size={16} /></button>
      <div id={hintId} className={`document-name-hint ${error ? "invalid" : ""}`} role={error ? "alert" : undefined}>
        {error || "Enterで確定 · Escで取消 · Ctrl＋Sで確定して保存"}
      </div>
    </form>
  );
}
