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

/**
 * v0.12.15: `repeat with m in (messages of … whose …)` then `delete m` compiles, finds the draft, and fails at run time
 * (the loop item is a reference into a list, not Mail's message), so every move to Trash was refused. A script must
 * delete Mail's own reference (`set m to (first message of … whose id is …)`). Returns the offending loop line, or null.
 */
export function deleteOfLoopItem(script: string): string | null {
  const lines = script.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*repeat with (\w+) in /.exec(lines[i] ?? "");
    if (!m) continue;
    const v = m[1] as string;
    let depth = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? "";
      if (/^\s*repeat\b/.test(l)) depth++;
      if (/^\s*end repeat\b/.test(l)) {
        if (depth === 0) break;
        depth--;
      }
      if (new RegExp(`^\\s*set ${v} to `).test(l)) break;
      if (new RegExp(`^\\s*delete ${v}\\s*$`).test(l)) return lines[i]?.trim() ?? "";
    }
  }
  return null;
}
