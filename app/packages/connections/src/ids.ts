import { SAFE_FILE, TELEGRAM_FILE } from "./kinds";

/** What a connection id names. The id is the only thing a client sends to pick a connection; it never carries a value. */
export type ConnectionRef =
  | { kind: "notion"; file: string }
  | { kind: "telegram"; file: string };

export const notionId = (file: string): string => `notion:${file}`;
export const TELEGRAM_ID = "telegram:bot";

/** `undefined` for anything that is not an id of this instance's own kinds; a file name that could leave the folder never parses. */
export function parseConnectionId(id: string): ConnectionRef | undefined {
  if (id === TELEGRAM_ID) return { kind: "telegram", file: TELEGRAM_FILE };
  const [kind, rest = "", ...more] = id.split(":");
  if (more.length || !rest) return undefined;
  if (kind === "notion" && SAFE_FILE.test(rest) && !rest.includes("..")) return { kind: "notion", file: rest };
  return undefined;
}
