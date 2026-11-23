// The one record format of every Hub AppleScript (P126 M1): fields separated by FS, records by RS, lists by LS, paragraphs
// of a list by PS; Mail's ids compared bare; Mail's local date stamps read back as instants.

export const FS = "\x1f";
export const RS = "\x1e";
export const LS = "\x1d";
export const PS = "\x1c";

/** The AppleScript lines that declare FS, RS and LS, for a script's `on run argv`. */
export const SEPARATORS = `
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set LS to (ASCII character 29)`;

/** A script's output split into its records, leading line breaks dropped, blank records skipped. */
export const records = (out: string): string[] => out.split(RS).map((r) => r.replace(/^[\r\n]+/, "")).filter((r) => r.trim() !== "");

/** An LS-separated field as lower-case entries (addresses). */
export const list = (v: string | undefined): string[] => (v ?? "").split(LS).map((x) => x.trim().toLowerCase()).filter(Boolean);

/** Message-ID with the angle brackets and spaces removed: how mailRef and Mail's `message id` are compared. */
export const bareId = (id: string | null | undefined): string => (id ?? "").trim().replace(/^<|>$/g, "").toLowerCase();

/** A Message-ID as Mail gives it back to a script: angle brackets and spaces removed, case kept (TS compares with `bareId`). */
export const rawId = (id: string | null | undefined): string => (id ?? "").trim().replace(/^<|>$/g, "");

/** Mail's local "y,m,d,seconds" as an instant: the Date constructor applies this machine's zone and DST, as Mail did. */
export function localStamp(stamp: string): string | null {
  const [y, m, d, s] = stamp.split(",").map(Number);
  if (![y, m, d, s].every((n) => Number.isFinite(n))) return null;
  return new Date(y!, m! - 1, d!, 0, 0, s!).toISOString();
}
