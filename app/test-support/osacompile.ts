import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Compiles an AppleScript with `osacompile` into a temp file and never runs it: no Mail call, no Apple event. A script
// that does not compile fails every osascript call before it reaches Mail (P65 fix: `set before to …` in the writer,
// `set since to …` in Sent detection; `before` and `since` are AppleScript keywords). The Hub's scripts take every
// value (subject, body, ids) as `argv` items, never inside the source, so their inputs cannot change what compiles.

/** osacompile exists on macOS only; elsewhere the compile tests skip. */
export const canCompileAppleScript = process.platform === "darwin";

/** null when the script compiles, else osacompile's error text. */
export function appleScriptCompileError(script: string): string | null {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-osacompile-"));
  try {
    const src = path.join(dir, "script.applescript");
    writeFileSync(src, script, "utf8");
    execFileSync("osacompile", ["-o", path.join(dir, "script.scpt"), src], { stdio: ["ignore", "ignore", "pipe"], timeout: 30_000 });
    return null;
  } catch (e) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim();
    return stderr || (e as Error).message;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
