import type { DocumentModel } from "../state/model";
export interface Command {
  label: string;
  apply: (document: DocumentModel) => DocumentModel;
}
export interface Revision {
  document: DocumentModel;
  token: number;
}
export class History {
  private past: Revision[] = [];
  private future: Revision[] = [];
  private serial = 0;
  private saved = 0;
  current: Revision;
  constructor(document: DocumentModel) {
    this.current = { document, token: 0 };
  }
  get dirty() {
    return this.current.token !== this.saved;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  execute(command: Command) {
    const next = command.apply(this.current.document);
    if (next === this.current.document) return;
    this.past.push(this.current);
    if (this.past.length > 80) this.past.shift();
    this.current = { document: next, token: ++this.serial };
    this.future = [];
  }
  undo() {
    const next = this.past.pop();
    if (next) {
      this.future.push(this.current);
      this.current = next;
    }
  }
  redo() {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.current);
      this.current = next;
    }
  }
  markSaved(token = this.current.token) {
    this.saved = token;
  }
  rename(name: string, path?: string) {
    const renameRevision = (r: Revision): Revision => ({
      ...r,
      document: { ...r.document, name, path },
    });
    this.current = renameRevision(this.current);
    this.past = this.past.map(renameRevision);
    this.future = this.future.map(renameRevision);
  }

  markRecovered() {
    this.saved = -1;
  }
}
