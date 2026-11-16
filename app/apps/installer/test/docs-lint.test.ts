import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context.ts";

const root = defaultRoot();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules") continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
const mdIn = (rel: string): string[] => [...walk(path.join(root, rel))].filter((f) => f.endsWith(".md")).map((f) => path.relative(root, f));

/** Top-level commands of the CLI: every `.command("x")` in the installer and the two packages that register commands, minus known subcommands. */
function registeredCommands(): Set<string> {
  const sources = [
    ...[...walk(path.join(root, "app", "apps", "installer", "src"))].filter((f) => f.endsWith(".ts")),
    path.join(root, "app", "packages", "projects", "src", "hub-commands.ts"),
    path.join(root, "app", "packages", "mail-filters", "src", "hub-commands.ts"),
  ];
  const names = new Set<string>();
  for (const f of sources) for (const m of readFileSync(f, "utf8").matchAll(/\.command\("([a-z][a-z-]*)"/g)) names.add(m[1]!);
  for (const sub of ["sync", "show"]) names.delete(sub); // `hub project sync`: never top-level
  names.add("filters"); // alias of mail-filters
  names.add("help");
  return names;
}

describe("docs only name commands that exist", () => {
  const docs = ["README.md", ...mdIn("@docs/core"), ...mdIn("skills")];
  const span = /`(?:\.\/hub\.sh|pnpm hub|hub) ([a-z][\w-]*)/g;
  const line = /^\s*(?:\$ )?(?:\.\/hub\.sh|pnpm hub|hub) ([a-z][\w-]*)/gm;
  it("every `hub <cmd>` and `./hub.sh <cmd>` is a registered command (hidden ones count)", () => {
    const known = registeredCommands();
    const bad: string[] = [];
    for (const f of docs) {
      const text = read(f);
      for (const re of [span, line]) for (const m of text.matchAll(re)) if (!known.has(m[1]!)) bad.push(`${f}: hub ${m[1]}`);
    }
    expect([...new Set(bad)], "unknown commands in docs").toEqual([]);
  });
  it("the deleted sync is not documented anywhere", () => {
    const hits = docs.filter((f) => /`(?:\.\/hub\.sh|pnpm hub|hub) (?:sync\b|up --sync)/.test(read(f)));
    expect(hits).toEqual([]);
  });
});

describe("docs paths and core hygiene", () => {
  it("no `@docs/NN` path without core/ or custom/ in the entry documents", () => {
    const files = ["README.md", "@docs/00-README.md", "@docs/LAYERS.md", ...mdIn("@docs/core"), ...mdIn("app/@rules"), ...mdIn("app/packages")];
    const bad = files.filter((f) => /@docs\/(?!00-README)\d\d/.test(read(f)));
    expect(bad).toEqual([]);
  });
  it("no file under @docs/core holds an absolute home path", () => {
    const bad = mdIn("@docs/core").filter((f) => /\/Users\/|\/home\/[a-z]/.test(read(f)));
    expect(bad).toEqual([]);
  });
  it("no document points at the old secrets folder", () => {
    const files = ["README.md", ...mdIn("@docs/core"), ...mdIn("app/@rules"), ...mdIn("app/packages"), ...mdIn("skills")];
    const bad = files.filter((f) => read(f).includes(".config/reforms-crm"));
    expect(bad).toEqual([]);
  });
});
