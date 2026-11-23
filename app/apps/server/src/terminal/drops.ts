import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dropFolder, type HubPaths } from "@hub/config/paths";
import { DROP_LIMITS } from "@hub/contract/terminal";

// P76, decision 0041: a file dropped on a terminal tab is copied here and its path pasted. The browser gives no path, so the
// server names the only one: `state/drops/<project or _shell>/<session>/<safe name>`. Nothing here types into a PTY.

/** The longest safe name, in characters, the extension kept. */
export const SAFE_NAME_MAX = 80;
/** An extension longer than this is part of the name (a `.tar.gz` keeps `.gz`). */
const EXT_MAX = 16;

/**
 * The one name on disk: the basename only, NFC; every character outside letters, digits, `.`, `_` and `-` becomes `-`, runs
 * collapsed; leading dots and dashes trimmed (no dotfile, no `..`); at most {@link SAFE_NAME_MAX} characters with the
 * extension kept; `file` when nothing is left. The pasted path then holds no space and no shell-special character of its own.
 */
export function safeName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "";
  const clean = base.normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/-{2,}/g, "-").replace(/^[.-]+/, "").replace(/-+$/, "");
  if (!clean) return "file";
  const chars = Array.from(clean);
  if (chars.length <= SAFE_NAME_MAX) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 && clean.length - dot <= EXT_MAX ? Array.from(clean.slice(dot)) : [];
  const stem = chars.slice(0, chars.length - ext.length).slice(0, SAFE_NAME_MAX - ext.length).join("").replace(/[.-]+$/, "");
  return (stem || "file") + ext.join("");
}

/** `name.ext`, `name-2.ext`, `name-3.ext`: the n-th try of a name that clashed. */
export const numbered = (name: string, n: number): string => {
  if (n < 2) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
};

export interface DroppedFile { name: string; bytes: Uint8Array }

/** Why a drop is refused before anything is written, or null: 1 to `DROP_LIMITS.files` files, `DROP_LIMITS.bytes` in all. */
export function dropRefusal(files: ReadonlyArray<{ size: number }>): { status: 400 | 413; message: string } | null {
  if (files.length === 0) return { status: 400, message: "no file in the drop" };
  if (files.length > DROP_LIMITS.files) return { status: 413, message: `a drop takes at most ${DROP_LIMITS.files} files, this one has ${files.length}` };
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > DROP_LIMITS.bytes) return { status: 413, message: `a drop takes ${DROP_LIMITS.bytes / 1024 / 1024} MiB in all, this one is ${(total / 1024 / 1024).toFixed(1)} MiB` };
  return null;
}

/**
 * Writes each file into the session's folder (mode 700) as a new file (mode 600, `wx`: never over another), a clash
 * numbered, and returns the absolute paths in the order given.
 */
export function writeDrop(paths: Pick<HubPaths, "drops">, project: string | null, session: string, files: readonly DroppedFile[]): string[] {
  const dir = dropFolder(paths, project, session);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return files.map((f) => {
    const name = safeName(f.name);
    for (let n = 1; ; n++) {
      const at = path.join(dir, numbered(name, n));
      try {
        writeFileSync(at, f.bytes, { flag: "wx", mode: 0o600 });
        return at;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST" || n >= 1000) throw e;
      }
    }
  });
}

/** One tab's folder gone (its tab closed). Never throws: a folder that is already gone is the goal. */
export function removeDrop(paths: Pick<HubPaths, "drops">, project: string | null, session: string): void {
  try { rmSync(dropFolder(paths, project, session), { recursive: true, force: true }); } catch { /* best effort */ }
}

/** Every drop gone: at server start and stop no session survives, so neither does a copy made for one. */
export function clearDrops(paths: Pick<HubPaths, "drops">): void {
  try { rmSync(paths.drops, { recursive: true, force: true }); } catch { /* best effort */ }
}
