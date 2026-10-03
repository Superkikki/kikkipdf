import type { PromptOptions } from "../components/Prompt";
export type Ask = (options: PromptOptions) => Promise<Record<string, string> | null>;
export type Work = (label: string, job: (signal: AbortSignal) => Promise<void>) => Promise<void>;
export type Progress = (value: number, label?: string) => void;
export type WorkspaceModal = "forms" | "signature" | "links" | "pageLabels" | null;
