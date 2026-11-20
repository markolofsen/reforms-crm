// P76, decision 0041: what a drop on the terminal is, and the text pasted for it. Pure: the view hands in the event's
// `DataTransfer` (structurally, so a test can build one without a DOM), the owner of the session decides what to do.

/** The part of a `DataTransferItem` read here: a folder is only visible through `webkitGetAsEntry` (absent in some browsers). */
type DropItem = { kind: string; webkitGetAsEntry?: () => { isDirectory: boolean } | null };
/** The part of a `DataTransfer` read here. */
export type DropSource<F = File> = { types: readonly string[]; files: ArrayLike<F> | null; items?: ArrayLike<DropItem> | null; getData: (type: string) => string };

/** Files to copy and paste the paths of; text or a URL to paste as is; a folder (refused); nothing usable. */
export type Dropped<F = File> = { kind: "files"; files: F[] } | { kind: "text"; text: string } | { kind: "folder" } | { kind: "none" };

/** The most text one drop pastes. */
export const DROP_TEXT_MAX = 100_000;

/** What a drag over the terminal carries, from its `types` alone (the only thing readable before the drop): files first. */
export function dragKind(types: readonly string[]): "files" | "text" | null {
  if (types.includes("Files")) return "files";
  if (types.includes("text/uri-list") || types.includes("text/plain")) return "text";
  return null;
}

/**
 * Text safe to paste: line ends made `\n`, every C0 control but tab and newline removed, DEL and C1 too (a dropped text
 * cannot end a bracketed paste early with its own `ESC[201~`, nor send a key), cut to {@link DROP_TEXT_MAX} characters.
 */
export function cleanText(text: string): string {
  const kept = (c: string) => {
    const n = c.codePointAt(0) ?? 0;
    return n === 9 || n === 10 || (n > 31 && n < 127) || n > 159;
  };
  return Array.from(text.replace(/\r\n?/g, "\n")).filter(kept).join("").slice(0, DROP_TEXT_MAX);
}

/** A `text/uri-list` as one line: its URLs, comments (`#`) dropped, one space apart. */
const uriLine = (list: string): string =>
  list
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .join(" ");

/** The drop, read synchronously inside the `drop` event (the data is gone after it). A folder among the files refuses them all. */
export function classifyDrop<F>(dt: DropSource<F>): Dropped<F> {
  if (dt.types.includes("Files")) {
    const items = Array.from(dt.items ?? []);
    if (items.some((i) => i.kind === "file" && i.webkitGetAsEntry?.()?.isDirectory === true)) return { kind: "folder" };
    const files = Array.from(dt.files ?? []);
    return files.length ? { kind: "files", files } : { kind: "none" };
  }
  const uris = dt.types.includes("text/uri-list") ? uriLine(dt.getData("text/uri-list")) : "";
  const text = cleanText(uris || (dt.types.includes("text/plain") ? dt.getData("text/plain") : ""));
  return text ? { kind: "text", text } : { kind: "none" };
}

/** A path every shell and both CLIs read bare. */
const BARE = /^[\p{L}\p{N}._/@+-]+$/u;

/** One path as typed: bare when it can be, else every other character backslash-escaped, as Terminal.app types a dragged path. */
export const shellPath = (p: string): string => (BARE.test(p) ? p : Array.from(p, (c) => (BARE.test(c) ? c : `\\${c}`)).join(""));

/** What the dock pastes for the copied files: each path, one space apart, and one space after, so the owner keeps typing. */
export const pasteLine = (paths: readonly string[]): string => `${paths.map(shellPath).join(" ")} `;
