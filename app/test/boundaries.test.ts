// P120 W5: the one package-boundary check, at the repo root. It covers every edge of the P113 matrix (folded into P120) and
// reads nothing outside `app/`. Run: `pnpm test:boundaries` (the root `test` runs it after the packages' own tests).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const app = path.resolve(import.meta.dirname, "..");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) yield* walk(file);
    else yield file;
  }
}

/** The TypeScript sources of a folder under `app/`, tests excluded unless asked. */
const sources = (dir: string, { tests = false } = {}) =>
  existsSync(path.join(app, dir)) ? [...walk(path.join(app, dir))].filter((f) => /\.tsx?$/.test(f) && (tests || !/\.test\.tsx?$/.test(f))) : [];

type Edge = { file: string; specifier: string };
const importsOf = (files: string[]): Edge[] =>
  files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/(?:\bfrom|\bimport\(?)\s*["']([^"'./][^"']*)["']/g)].map((m) => ({ file: path.relative(app, file), specifier: m[1] ?? "" })));
const breaking = (files: string[], forbidden: RegExp, allowed?: RegExp) =>
  importsOf(files)
    .filter(({ specifier }) => forbidden.test(specifier) && !(allowed?.test(specifier) ?? false))
    .map(({ file, specifier }) => `${file} -> ${specifier}`);

/** A server route module: it declares an `/api` route (P126 S1: `<domain>/*routes.ts` and `agent/tools.ts`). */
const routeFiles = sources("apps/server/src").filter((f) => /\.(get|post|put|patch|delete)\(\s*"\/api/.test(readFileSync(f, "utf8")));

describe("the P113 matrix: who may import whom", () => {
  it("@hub/config imports no other Hub package", () => {
    expect(breaking(sources("packages/config/src"), /^@hub\//)).toEqual([]);
  });
  it("@hub/contract imports zod and @hub/config only: no DB, server, UI, projects, messengers, send or agent", () => {
    expect(breaking(sources("packages/contract/src"), /^(?!zod$)/, /^@hub\/config(\/|$)/)).toEqual([]);
  });
  it("@hub/projects/model (schema.ts) is pure: no DB, filesystem, Notion, Hono or API client", () => {
    expect(breaking([path.join(app, "packages/projects/src/schema.ts")], /^(node:fs|node:path|fs$|@hub\/(db|notion|api)|hono)/)).toEqual([]);
  });
  it("@hub/ui imports no Hub package and no next/*", () => {
    expect(breaking(sources("packages/ui/src"), /^(@hub\/|next(\/|$))/)).toEqual([]);
  });
  it("@hub/mail-app is an adapter: it imports @hub/config, @hub/log and @hub/db only", () => {
    expect(breaking(sources("packages/mail-app/src"), /^@hub\//, /^@hub\/(config|log|db)(\/|$)/)).toEqual([]);
  });
  it("@hub/agent has no path to human send doors, the Mail send or product UI", () => {
    expect(breaking(sources("packages/agent/src"), /^@hub\/(send|messengers\/human|ui)(\/|$)/)).toEqual([]);
  });
  it("@hub/api (generated transport, runtime, ledger) depends on no domain package", () => {
    expect(breaking(sources("packages/api/src"), /^@hub\//, /^@hub\/(contract|config)(\/|$)/)).toEqual([]);
  });
  it("apps/admin is a client of the API: no DB, server or Node-only package, no generated deep path", () => {
    expect(breaking(sources("apps/admin/src"), /^@hub\/(db|notion|send|messengers|projects|sequences|terminal|agent|server|mail-app|llm|knowledge|connections)(\/|$)|^@hub\/api\/(generated|src)/)).toEqual([]);
  });
  it("apps/storybook composes @hub/ui only: no API, generated client or admin module", () => {
    expect(breaking(sources("apps/storybook/src"), /^@hub\/(?!ui(\/|$)|contract(\/|$)|config(\/|$))|^@\//)).toEqual([]);
  });
});

describe("protected edges", () => {
  it("a server route module imports no @hub/db (P120 verdict 3): it takes its domain's context", () => {
    expect(routeFiles.length).toBeGreaterThan(20);
    expect(breaking(routeFiles, /^@hub\/db(\/|$)/)).toEqual([]);
  });
  it("a server route module reaches no Mail.app implementation: only its pure text, record and type modules", () => {
    expect(breaking(routeFiles, /^@hub\/mail-app(\/|$)/, /^@hub\/mail-app\/(own-text|records|drafts|writer\/types)$/)).toEqual([]);
  });
  it("no module reaches another package's src/ internals", () => {
    expect(breaking([...sources("apps"), ...sources("packages")], /^@hub\/[^/]+\/src(\/|$)/)).toEqual([]);
  });
  it("no compatibility barrel (P120 verdict 2): no @hub/projects root, no @hub/contract root or responses", () => {
    const all = [...sources("apps", { tests: true }), ...sources("packages", { tests: true })];
    expect(breaking(all, /^@hub\/projects$|^@hub\/contract(\/responses)?$/)).toEqual([]);
    const pkg = (p: string) => JSON.parse(readFileSync(path.join(app, p), "utf8")) as { exports: Record<string, string> };
    expect(pkg("packages/projects/package.json").exports["."]).toBeUndefined();
    expect(pkg("packages/contract/package.json").exports["./responses"]).toBeUndefined();
  });
  it("the owner-gated human capability reaches one route module, the autolink's (link and confirm); the send routes use the door", () => {
    const human = routeFiles.filter((f) => importsOf([f]).some(({ specifier }) => specifier === "@hub/messengers/human")).map((f) => path.relative(app, f));
    expect(human).toEqual(["apps/server/src/messengers/autolink/routes.ts"]);
    expect(importsOf([path.join(app, "apps/server/src/send/sends-routes.ts")]).map((e) => e.specifier)).toContain("@hub/messengers/door");
  });
});
