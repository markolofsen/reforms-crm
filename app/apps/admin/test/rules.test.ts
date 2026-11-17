import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { ADMIN_PORT } from "@hub/config";
import { FILE_LINE_CAP, LINE_COUNT } from "../lint-limits.mjs";

// Executable half of `app/@rules` (see its Enforcement sections). Hard gates: every count is zero, nothing is ratcheted.
const admin = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(admin, "../../..");
const src = path.join(admin, "src");

const DIR_FILE_CAP = 8;
const PAGE_LINE_CAP = 40;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
const rel = (p: string) => path.relative(src, p).split(path.sep).join("/");
const sourceFiles = [...walk(src)].filter((p) => /\.tsx?$/.test(p));
// Copied from the coss registry and not hand-edited (`components/ui/*` and the hook the sidebar needs).
const COSS_COPIES = new Set(["hooks/use-media-query.ts"]);
const appFiles = sourceFiles.filter((p) => !rel(p).startsWith("components/ui/") && !COSS_COPIES.has(rel(p)) && !/\.test\.tsx?$/.test(p));
const read = (p: string) => readFileSync(p, "utf8");
// Comments are not code: a rule's own name may appear in one.
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const inDir = (dir: string) => appFiles.filter((p) => rel(p).startsWith(`${dir}/`));
const offenders = (files: string[], re: RegExp) => files.filter((p) => re.test(code(p))).map(rel);

function count(file: string) {
  const text = read(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const c = { rawButton: 0, rawAnchor: 0, typeAssertion: 0, nonNull: 0 };
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      if (tag === "button") c.rawButton++;
      if (tag === "a") c.rawAnchor++;
    }
    if (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) {
      const t = n.type;
      if (!(ts.isTypeReferenceNode(t) && t.typeName.getText(sf) === "const")) c.typeAssertion++;
    }
    if (ts.isNonNullExpression(n)) c.nonNull++;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return c;
}

describe("file size cap", () => {
  // The cap and the way lines are counted are `lint-limits.mjs`, the same numbers eslint `max-lines` uses.
  it(`no source file over ${FILE_LINE_CAP} lines (blank and comment-only lines are not counted: ${JSON.stringify(LINE_COUNT)})`, () => {
    const counted = (p: string) => code(p).split("\n").filter((l) => !LINE_COUNT.skipBlankLines || l.trim() !== "").length;
    expect(appFiles.filter((p) => counted(p) > FILE_LINE_CAP).map(rel)).toEqual([]);
  });
  it(`a page.tsx is thin: at most ${PAGE_LINE_CAP} lines (await the params, parse the search, render a feature)`, () => {
    const pages = appFiles.filter((p) => rel(p).startsWith("app/") && /\/page\.tsx$/.test(p));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.filter((p) => read(p).split("\n").length > PAGE_LINE_CAP).map(rel)).toEqual([]);
  });
});

describe("typing and markup gates (hard, no baseline)", () => {
  const total = { rawButton: 0, rawAnchor: 0, typeAssertion: 0, nonNull: 0 };
  for (const f of appFiles) {
    const c = count(f);
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += c[k];
  }
  for (const k of Object.keys(total) as (keyof typeof total)[]) {
    it(`${k} is 0`, () => {
      expect(total[k]).toBe(0);
    });
  }
});

// Navigation (`app/@rules/routes-and-url-state.md`): real paths, one typed link, next/* navigation only where it is allowed.
const NEXT_NAV_MODULES = (f: string) => f.startsWith("app/") || f.startsWith("hooks/") || f === "components/app-link.tsx";
const ADDRESS_BAR_MODULES = new Set(["hooks/use-search-state.ts", "lib/external.ts"]);

describe("one navigation layer (rules: routes-and-url-state)", () => {
  it("no `#/` address anywhere: the hash routes are gone", () => {
    expect(offenders(appFiles, /["'`]#\//)).toEqual([]);
  });
  it("a path or URL string literal is written only by src/routes (no string `href`/`to`)", () => {
    const files = appFiles.filter((p) => !rel(p).startsWith("routes/"));
    expect(offenders(files, /\b(href|to)=(\{\s*)?(["'`]\/|`\$\{)/)).toEqual([]);
    expect(offenders(files, /\b(go|navigate)\(\s*["'`]\//)).toEqual([]);
    expect(offenders(files, /\b(push|replace|prefetch)\(\s*["'`]\//)).toEqual([]);
  });
  it("next/link, next/navigation and next/router are imported only by src/app, src/hooks and components/app-link.tsx", () => {
    const files = appFiles.filter((p) => !NEXT_NAV_MODULES(rel(p)));
    expect(offenders(files, /from\s+["']next\/(link|navigation|router)["']/)).toEqual([]);
    expect(offenders(files, /\brequire\(\s*["']next\/(link|navigation|router)/)).toEqual([]);
  });
  it("the address bar (location, history, cookie) is touched only by use-search-state, external and storage", () => {
    const files = appFiles.filter((p) => !ADDRESS_BAR_MODULES.has(rel(p)));
    expect(offenders(files, /\bwindow\.(location|history)\b|(?<![.\w])(location|history)\.(hash|href|pathname|search|assign|replace|pushState|replaceState|back|forward)\b/)).toEqual([]);
    expect(offenders(appFiles.filter((p) => rel(p) !== "lib/storage.ts"), /\bdocument\.cookie\b/)).toEqual([]);
  });
  it("the old router is gone: no hash history, no router.ts", () => {
    expect(existsSync(path.join(src, "router.ts"))).toBe(false);
    expect(offenders(appFiles, /createHistory\(|\bhashchange\b/)).toEqual([]);
  });
  it("src/routes imports no React, component, feature, hook or navigation library", () => {
    expect(offenders(inDir("routes"), /from\s+["'](react|react-dom|next\/(link|navigation|router)|@\/(components|features|hooks))/)).toEqual([]);
  });
  it("search is parsed once, in routes: no URLSearchParams or params.get in features, components or hooks; only use-route and use-project read the live query", () => {
    const readers = [...inDir("features"), ...inDir("components"), ...inDir("hooks")];
    expect(offenders(readers, /URLSearchParams|\bparams\.get\(|\.searchParams\b/)).toEqual([]);
    expect(offenders(readers.filter((p) => !["hooks/use-route.ts", "hooks/use-project.ts"].includes(rel(p))), /\buseSearchParams\b/)).toEqual([]);
  });
  it("the title is Next metadata: nothing writes document.title", () => {
    expect(offenders(appFiles, /document\.title\s*=/)).toEqual([]);
  });
});

describe("the server boundary (decision 0015 section 4 and 5)", () => {
  it('no Server Action: no "use server" anywhere in the admin', () => {
    expect(sourceFiles.filter((p) => /["']use server["']/.test(read(p))).map(rel)).toEqual([]);
  });
  it("no database, mail or server value import: the admin talks to /api, and `import type` is the only way to @hub/server", () => {
    expect(offenders(appFiles, /from\s+["']@hub\/(db|mail|notion|send|messengers|projects)(\/|["'])/)).toEqual([]);
    expect(offenders(appFiles, /\bimport\s+(?!type\b)[^;]*from\s+["']@hub\/server/)).toEqual([]);
  });
  it("no NEXT_PUBLIC_ variable, no .env file: the admin holds no secret", () => {
    const files = [...appFiles, path.join(admin, "next.config.ts"), path.join(admin, "package.json")];
    expect(files.filter((p) => /NEXT_PUBLIC_/.test(read(p))).map((p) => path.relative(admin, p))).toEqual([]);
    expect(readdirSync(admin).filter((f) => f.startsWith(".env"))).toEqual([]);
    expect(readdirSync(path.join(repo, "app")).filter((f) => f.startsWith(".env"))).toEqual([]);
  });
  it("nothing under the admin reads state/secrets", () => {
    expect(offenders(appFiles, /state\/secrets|HUB_CONFIG_DIR/)).toEqual([]);
  });
});

describe("the Next shell of the app", () => {
  const config = read(path.join(admin, "next.config.ts"));
  const pkg = JSON.parse(read(path.join(admin, "package.json"))) as { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> };
  it("the root layout is force-dynamic and owns the one theme script", () => {
    const layout = read(path.join(src, "app/layout.tsx"));
    expect(layout).toMatch(/export const dynamic = "force-dynamic"/);
    expect(layout).toContain("suppressHydrationWarning");
    expect(offenders(appFiles.filter((p) => rel(p) !== "app/layout.tsx"), /classList\.toggle\(\s*["']dark["']/)).toEqual([]);
  });
  it("proxy.ts lives in src/ (at the app root Next ignores it) and guards Host and Origin", () => {
    expect(existsSync(path.join(admin, "proxy.ts"))).toBe(false);
    const proxy = read(path.join(src, "proxy.ts"));
    expect(proxy).toContain("ALLOWED_HOSTNAMES");
    expect(proxy).toMatch(/forbidden (host|origin)/);
  });
  it("next.config: typed routes on, agent rules off, proxy timeout raised, no static export", () => {
    expect(config).toMatch(/typedRoutes:\s*true/);
    expect(config).toMatch(/agentRules:\s*false/);
    expect(config).toMatch(/proxyTimeout:\s*\d/);
    expect(config).toContain("allowedDevOrigins");
    expect(config).not.toMatch(/\boutput\s*:/);
    expect(config).not.toMatch(/\bwebpack\s*[:(]/);
  });
  it("dev and start bind to 127.0.0.1 and read their port from a variable", () => {
    for (const s of ["dev", "start"]) {
      expect(pkg.scripts[s], s).toMatch(/-H 127\.0\.0\.1/);
      expect(pkg.scripts[s], s).toContain(`-p \${HUB_ADMIN_PORT:-${ADMIN_PORT}}`);
    }
  });
  it("one alias source, `@/*` in tsconfig.json, read by vitest; no second bundler or router is a dependency", () => {
    const tsconfig = JSON.parse(read(path.join(admin, "tsconfig.json"))) as { compilerOptions: { paths?: Record<string, string[]> } };
    expect(tsconfig.compilerOptions.paths).toEqual({ "@/*": ["./src/*"] });
    expect(read(path.join(admin, "vitest.config.ts"))).toContain("tsconfigPaths: true");
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    // The retired names are spelled in pieces so a repo-wide grep for them stays empty (P32 N8).
    const retired = ["vi" + "te", "wou" + "ter", "@tailwindcss/vi" + "te"];
    expect(deps.filter((d) => retired.includes(d) || d.startsWith("@vi" + "tejs/"))).toEqual([]);
    expect(existsSync(path.join(admin, "vi" + "te.config.ts"))).toBe(false);
  });
  it("turbo: `hub up` builds then starts; a cached build is keyed on the API port, the dist dir and the shared packages", () => {
    const turbo = JSON.parse(read(path.resolve(admin, "..", "..", "turbo.json"))) as { globalPassThroughEnv: string[]; tasks: Record<string, { dependsOn?: string[]; env?: string[]; inputs?: string[]; persistent?: boolean; cache?: boolean }> };
    expect(turbo.tasks.start).toMatchObject({ dependsOn: ["build"], persistent: true, cache: false });
    expect(turbo.tasks.build?.env).toEqual(expect.arrayContaining(["HUB_PORT", "HUB_NEXT_DIST", "HUB_NEXT_ROOT"]));
    expect(turbo.tasks.build?.inputs).toEqual(expect.arrayContaining(["$TURBO_ROOT$/packages/contract/**", "$TURBO_ROOT$/packages/config/**"]));
    expect(turbo.globalPassThroughEnv).toContain("HUB_ADMIN_PORT");
  });
  it("every dependency is an exact pin", () => {
    const loose = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, v]) => !v.startsWith("workspace:") && !/^\d+\.\d+\.\d+$/.test(v));
    expect(loose).toEqual([]);
  });
});

// Stable first render (rules: state-and-data 11): the server has no viewport, storage or clock, so a first render that reads
// one mismatches on hydration. These are read through useSyncExternalStore with a server snapshot, or after mount.
describe("stable first render", () => {
  it("no useState initializer reads the window, the document, storage, the media query or the clock", () => {
    expect(offenders(appFiles, /useState(<[^>]*>)?\(\s*(\(\)\s*=>\s*)?[^)]*\b(window|document|localStorage|sessionStorage|matchMedia|Date\.now|new Date|performance\.now)\b/)).toEqual([]);
  });
  it("matchMedia is called only by use-media-query (a coss copy) and by the theme script of the root layout", () => {
    expect(offenders(appFiles.filter((p) => rel(p) !== "app/layout.tsx"), /\bmatchMedia\(/)).toEqual([]);
  });
});

describe("directory size", () => {
  it(`no directory outside components/ui and src/app holds more than ${DIR_FILE_CAP} source files`, () => {
    const byDir = new Map<string, number>();
    for (const p of appFiles) {
      if (rel(p).startsWith("app/")) continue; // file names there are the framework's (page, layout, error, not-found)
      byDir.set(path.dirname(rel(p)), (byDir.get(path.dirname(rel(p))) ?? 0) + 1);
    }
    expect([...byDir].filter(([, n]) => n > DIR_FILE_CAP)).toEqual([]);
  });
  it("hooks/ holds at most 8 files", () => {
    expect(inDir("hooks").length).toBeLessThanOrEqual(8);
  });
  it("no dead barrel: an index.ts that only re-exports", () => {
    expect(appFiles.filter((p) => /\/index\.tsx?$/.test(p) && /^\s*export\s+(\*|\{)/m.test(read(p))).map(rel)).toEqual([]);
  });
});

describe("app/@rules pages", () => {
  const dir = path.join(repo, "app", "@rules");
  const pages = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "SOURCE.md") : [];
  const OPERATIONAL = new Set(["live-edit.md", "skills.md"]);
  it("every page is indexed in README.md and has MUST and Enforcement sections", () => {
    const readme = read(path.join(dir, "README.md"));
    for (const p of pages) {
      expect(readme, `${p} missing from README.md`).toContain(p);
      if (OPERATIONAL.has(p)) continue; // operational pages, not rule pages
      const body = read(path.join(dir, p));
      expect(body, `${p}: no MUST`).toMatch(/\bMUST\b/);
      expect(body, `${p}: no Enforcement section`).toMatch(/^## Enforcement/m);
    }
  });
  it("SOURCE.md names every adapted page", () => {
    const source = read(path.join(dir, "SOURCE.md"));
    for (const p of pages) if (!OPERATIONAL.has(p)) expect(source, `${p} missing from SOURCE.md`).toContain(p);
  });
  it("the Next pages state the Next facts, and no page still describes the hash router", () => {
    const text = (f: string) => read(path.join(dir, f));
    expect(text("routes-and-url-state.md")).toMatch(/`\/drafts\/42\?project=/);
    expect(text("routes-and-url-state.md")).toContain("proxy.ts");
    expect(text("architecture-and-ownership.md")).toContain("turbopack.root");
    expect(text("verification.md")).toContain("force-dynamic");
    for (const p of pages) expect(text(p), `${p} still describes the hash router`).not.toMatch(/#\/drafts|hash history|hash-routed/);
  });
  it("every file path an enforcement row names exists", () => {
    const missing: string[] = [];
    for (const p of pages) {
      for (const m of read(path.join(dir, p)).matchAll(/`((?:test|e2e|src)\/[\w./\[\]()-]+\.(?:ts|tsx))`/g)) if (!existsSync(path.join(admin, m[1]!))) missing.push(`${p}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
});

// Sizes and variants (rules: design-system-and-tokens 11): one button, three heights, four looks.
describe("buttons and control sizes", () => {
  it("only action-button.tsx imports the coss Button", () => {
    expect(offenders(appFiles.filter((p) => rel(p) !== "components/action-button.tsx"), /from\s+["']@\/components\/ui\/button["']/)).toEqual([]);
  });
  it("the three heights are tokens, and below 1024px a target is 44px", () => {
    const css = read(path.join(src, "index.css"));
    for (const t of ["--control-s: 2rem", "--control-m: 2.5rem", "--control-l: 3rem", "--control-s: 2.75rem", "--control-m: 2.75rem"]) expect(css, t).toContain(t);
  });
  it("no per-component touch hack is left", () => {
    expect(offenders(appFiles, /max-lg:(min-)?[hw]-11|TOUCH_INPUT/)).toEqual([]);
  });
});

// Words the owner does not read (research 16 section 4): the product says them another way, in every file that renders text.
describe("product copy", () => {
  const BANNED: [RegExp, string][] = [
    [/Agent log/, "the section is Activity"],
    [/\brun #|"Run #|>#\{r\.id\}/, "a run is a sentence, not a number"],
    [/No reason was recorded/, "say what to do, not what is missing"],
    [/Reply all \+ copy/, "one plain verb"],
    [/Nothing is sent from here/, "say what the page does"],
    [/Stop all sends|Stop every project/, "one Stop sending"],
  ];
  it("no banned phrase in rendered code", () => {
    for (const [re, why] of BANNED) expect(offenders(appFiles, re), `${re}: ${why}`).toEqual([]);
  });
});

// design-system-and-tokens 13: the JS breakpoint and the CSS one are one number, or the sidebar and the tab bar disagree.
describe("one md breakpoint", () => {
  it("index.css and use-media-query.ts both say 640px", () => {
    expect(read(path.join(src, "index.css"))).toContain("--breakpoint-md: 40rem");
    expect(read(path.join(src, "hooks/use-media-query.ts"))).toMatch(/md:\s*640\b/);
  });
});
