import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const admin = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(admin, "../../..");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) yield* walk(file);
    else yield file;
  }
}

const sourceFiles = (dir: string) =>
  [...walk(path.join(repo, dir))].filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));

const importsOf = (files: string[]) =>
  files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((match) => ({
      file: path.relative(repo, file),
      specifier: match[1]!,
    }));
  });

const forbidden = (files: string[], pattern: RegExp) => importsOf(files).filter(({ specifier }) => pattern.test(specifier));

describe("package boundaries", () => {
  it("@hub/ui stays independent from domain packages and apps", () => {
    expect(forbidden(sourceFiles("app/packages/ui/src"), /^@hub\//)).toEqual([]);
  });

  it("@hub/agent has no path to human send doors or product UI", () => {
    expect(forbidden(sourceFiles("app/packages/agent/src"), /^@hub\/(send|messengers\/human|ui)(\/|$)/)).toEqual([]);
  });

  it("@hub/mail-app is an adapter: it imports no Hub package but @hub/config, @hub/log and @hub/db (P126 M1-M2, tier 3 over tiers 0-1)", () => {
    expect(forbidden(sourceFiles("app/packages/mail-app/src"), /^@hub\/(?!config(\/|$)|log(\/|$)|db(\/|$))/)).toEqual([]);
  });

  it("generated API transport does not depend on domain write packages", () => {
    expect(forbidden(sourceFiles("app/packages/api/src/generated"), /^@hub\/(send|messengers)(\/|$)/)).toEqual([]);
  });

  it("server route adapters do not reach package internals", () => {
    expect(forbidden(sourceFiles("app/apps/server/src"), /^@hub\/[^/]+\/src\//)).toEqual([]);
  });
});
