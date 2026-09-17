import { newObject, type Box } from "../state/model";
/** Replaceable adapter. This masks appearance; it does NOT remove source text. Never use for redaction. */
export interface ExistingTextEngine {
  readonly strategy: string;
  replace(
    text: string,
    box: Box,
    fontSize: number,
  ): ReturnType<typeof newObject>;
}
export const appearanceTextEngine: ExistingTextEngine = {
  strategy: "appearance-mask",
  replace(text, box, fontSize) {
    return {
      ...newObject("replacement", box.x, box.y),
      ...box,
      text,
      fontSize,
      fill: "#ffffff",
    };
  },
};
