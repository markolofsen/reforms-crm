import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROOT, FILE_RATCHET, FUNCTION_RATCHET } from "../src/eslint.mjs";
import { FILE_LINE_CAP, FUNCTION_LINE_CAP } from "../src/lint-limits.mjs";

// Lines as `LINE_COUNT` counts them: a blank line and a line holding only a comment do not count. Close to eslint's own count;
// eslint's `max-lines` with the listed number is the gate, this test keeps the list honest.
function codeLines(text: string): number {
  let inBlock = false;
  let n = 0;
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end < 0) continue;
      inBlock = false;
      line = line.slice(end + 2).trim();
      if (line) n += 1;
      continue;
    }
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      const end = line.indexOf("*/", 2);
      if (end < 0) inBlock = true;
      else if (line.slice(end + 2).trim()) n += 1;
      continue;
    }
    n += 1;
  }
  return n;
}

const workspaces = ["apps", "packages"].flatMap((group) =>
  readdirSync(join(APP_ROOT, group), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(APP_ROOT, group, d.name, "package.json")))
    .map((d) => `${group}/${d.name}`),
);

describe("the size ratchet (P121 verdict 2)", () => {
  it.each(Object.entries(FILE_RATCHET))("%s is still over the cap and not over its own number", (file, max) => {
    const path = join(APP_ROOT, file);
    expect(existsSync(path), `${file} is gone: drop it from FILE_RATCHET`).toBe(true);
    const n = codeLines(readFileSync(path, "utf8"));
    expect(n, `${file} is under ${FILE_LINE_CAP} now: drop it from FILE_RATCHET`).toBeGreaterThan(FILE_LINE_CAP);
    expect(n, `${file} grew past its ratchet: split it`).toBeLessThanOrEqual(max);
  });
  it("lists function exceptions above the function cap only", () => {
    for (const [file, max] of Object.entries(FUNCTION_RATCHET)) {
      expect(existsSync(join(APP_ROOT, file)), file).toBe(true);
      expect(max, file).toBeGreaterThan(FUNCTION_LINE_CAP);
    }
  });
});

describe("lint runs in every workspace (P121 verdict 1)", () => {
  it.each(workspaces)("%s has an eslint config and a lint script", (ws) => {
    expect(existsSync(join(APP_ROOT, ws, "eslint.config.mjs")), `${ws}/eslint.config.mjs`).toBe(true);
    const pkg = JSON.parse(readFileSync(join(APP_ROOT, ws, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.lint, `${ws} "lint" script`).toBe("eslint .");
  });
});
