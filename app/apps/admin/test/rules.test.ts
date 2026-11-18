import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_PORT } from "@hub/config";

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
const appFiles = sourceFiles.filter((p) => !/\.test\.tsx?$/.test(p));
const read = (p: string) => readFileSync(p, "utf8");
// Comments are not code: a rule's own name may appear in one.
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const inDir = (dir: string) => appFiles.filter((p) => rel(p).startsWith(`${dir}/`));
const offenders = (files: string[], re: RegExp) => files.filter((p) => re.test(code(p))).map(rel);

describe("page size", () => {
  it(`a page.tsx is thin: at most ${PAGE_LINE_CAP} lines (await the params, parse the search, render a feature)`, () => {
    const pages = appFiles.filter((p) => rel(p).startsWith("app/") && /\/page\.tsx$/.test(p));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.filter((p) => read(p).split("\n").length > PAGE_LINE_CAP).map(rel)).toEqual([]);
  });
});

// Navigation (`app/@rules/routes-and-url-state.md`): real paths, one typed link, next/* navigation only where it is allowed.
const NEXT_NAV_MODULES = (f: string) => f.startsWith("app/") || f.startsWith("hooks/") || f === "components/app-link.tsx";

describe("one navigation layer: what eslint cannot see (rules: routes-and-url-state 1-4)", () => {
  it("no `#/` address anywhere: the hash routes are gone", () => {
    expect(offenders(appFiles, /["'`]#\//)).toEqual([]);
  });
  // eslint `no-restricted-syntax` sees a string or template `href`/`to` and `go()`; it does not see these.
  it("no template href that starts with an expression, no router.push/replace/prefetch with a path literal", () => {
    const files = appFiles.filter((p) => !rel(p).startsWith("routes/"));
    expect(offenders(files, /\b(href|to)=\{`\$\{/)).toEqual([]);
    expect(offenders(files, /\b(push|replace|prefetch)\(\s*["'`]\//)).toEqual([]);
  });
  it("next/navigation is not pulled in with require() (eslint `no-restricted-imports` sees only import)", () => {
    expect(offenders(appFiles.filter((p) => !NEXT_NAV_MODULES(rel(p))), /\brequire\(\s*["']next\/(link|navigation|router)/)).toEqual([]);
  });
  // eslint `no-restricted-globals` and `no-restricted-syntax` see location and history; nothing but this test sees the cookie.
  it("document.cookie is touched only by lib/storage.ts", () => {
    expect(offenders(appFiles.filter((p) => rel(p) !== "lib/storage.ts"), /\bdocument\.cookie\b/)).toEqual([]);
  });
  it("the old router is gone: no hash history, no router.ts", () => {
    expect(existsSync(path.join(src, "router.ts"))).toBe(false);
    expect(offenders(appFiles, /createHistory\(|\bhashchange\b/)).toEqual([]);
  });
  it("search is parsed once, in routes: no URLSearchParams or params.get in features, components or hooks; only use-route and use-project read the live query", () => {
    const readers = [...inDir("features"), ...inDir("components"), ...inDir("hooks")];
    expect(offenders(readers, /URLSearchParams|\bparams\.get\(|\.searchParams\b/)).toEqual([]);
    expect(offenders(readers.filter((p) => !["hooks/use-route.ts", "hooks/use-project.ts"].includes(rel(p))), /\buseSearchParams\b/)).toEqual([]);
  });
});

// `use server` and every @hub/* server package import are eslint errors (`no-restricted-syntax`, `no-restricted-imports`); what is left is what lint cannot read.
describe("the server boundary (decision 0015 section 4 and 5)", () => {
  it("no NEXT_PUBLIC_ variable, no .env file: the admin holds no secret", () => {
    const files = [...appFiles, path.join(admin, "next.config.ts"), path.join(admin, "package.json")];
    expect(files.filter((p) => /NEXT_PUBLIC_/.test(read(p))).map((p) => path.relative(admin, p))).toEqual([]);
    expect(readdirSync(admin).filter((f) => f.startsWith(".env"))).toEqual([]);
    expect(readdirSync(path.join(repo, "app")).filter((f) => f.startsWith(".env"))).toEqual([]);
  });
  it("nothing under the admin reads state/secrets", () => {
    expect(offenders(appFiles, /state\/secrets|HUB_CONFIG_DIR/)).toEqual([]);
  });
  it("@hub/sequences (P47) is a banned import: the eslint list names it and no admin file imports it", () => {
    const config = read(path.join(admin, "eslint.config.mjs"));
    expect(/const SERVER_PACKAGES = \[[^\]]*"sequences"[^\]]*\]/.test(config)).toBe(true);
    expect(offenders(appFiles, /from ["']@hub\/sequences/)).toEqual([]);
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
    expect(turbo.tasks.build?.inputs).toEqual(expect.arrayContaining(["$TURBO_ROOT$/packages/contract/**", "$TURBO_ROOT$/packages/config/**", "$TURBO_ROOT$/packages/ui/**"]));
    expect(turbo.globalPassThroughEnv).toContain("HUB_ADMIN_PORT");
  });
  it("every dependency is an exact pin", () => {
    // `catalog:` names the shared version in pnpm-workspace.yaml: that version must itself be an exact pin.
    const loose = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, v]) => !v.startsWith("workspace:") && v !== "catalog:" && !/^\d+\.\d+\.\d+$/.test(v));
    expect(loose).toEqual([]);
    const yaml = readFileSync(path.join(repo, "app/pnpm-workspace.yaml"), "utf8");
    const catalog = yaml.split(/^catalog:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
    const versions = [...catalog.matchAll(/^\s+\S+:\s*(\S+)\s*$/gm)].map((m) => m[1]!);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.filter((v) => !/^\d+\.\d+\.\d+$/.test(v))).toEqual([]);
  });
});

// Stable first render (rules: state-and-data 11): the server has no viewport, storage or clock, so a first render that reads
// one mismatches on hydration. These are read through useSyncExternalStore with a server snapshot, or after mount.
describe("stable first render", () => {
  it("no useState initializer reads the window, the document, storage, the media query or the clock", () => {
    expect(offenders(appFiles, /useState(<[^>]*>)?\(\s*(\(\)\s*=>\s*)?[^)]*\b(window|document|localStorage|sessionStorage|matchMedia|Date\.now|new Date|performance\.now)\b/)).toEqual([]);
  });
  it("matchMedia is called only by `@hub/ui/use-media-query` (never in admin src) and by the theme script of the root layout", () => {
    expect(offenders(appFiles.filter((p) => rel(p) !== "app/layout.tsx"), /\bmatchMedia\(/)).toEqual([]);
  });
});

describe("directory size", () => {
  it(`no directory outside src/app holds more than ${DIR_FILE_CAP} source files`, () => {
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

// Sizes (rules: design-system-and-tokens 11): one button, three heights, four looks.
describe("buttons and control sizes", () => {
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

// The three control heights and the one md breakpoint are tokens of `@hub/ui`; its own test (packages/ui/test/ui.test.ts) holds them.
