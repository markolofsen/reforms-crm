import { styleText } from "node:util";

type Style = Parameters<typeof styleText>[0];
const s = (style: Style) => (t: string): string => styleText(style, t);

/** Terminal colours. styleText drops the escape codes itself when the stream is not a terminal or NO_COLOR is set. */
export const c = {
  bold: s("bold"),
  dim: s("dim"),
  red: s("red"),
  green: s("green"),
  yellow: s("yellow"),
  cyan: s("cyan"),
  magenta: s("magenta"),
};

/** A usage or user-facing error: printed as one line without a stack, exit code 2. */
export class UsageError extends Error {}
