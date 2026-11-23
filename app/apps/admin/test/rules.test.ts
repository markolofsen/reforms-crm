import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_PORT } from "@hub/config";
import { apiFamily, generatedOperations, rawPaths } from "@hub/api/ledger";

// Executable half of `app/@rules` (see its Enforcement sections). Hard gates: every count is zero, nothing is ratcheted.
const admin = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(admin, "../../..");
const src = path.join(admin, "src");

const DIR_FILE_CAP = 8;
const PAGE_LINE_CAP = 40;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules") continue;
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

// Live panels (P50, `state-and-data.md` rules 2 and 13): one key factory, one stream.
describe("one key factory, one live stream", () => {
  it("no query key is a literal outside lib/cache/keys.ts", () => {
    expect(offenders(appFiles.filter((p) => rel(p) !== "lib/cache/keys.ts"), /queryKey:\s*\[/)).toEqual([]);
  });
  it("the shared focus (P51) is posted only from lib/api/terminal.ts", () => {
    expect(offenders(appFiles.filter((p) => rel(p) !== "lib/api/terminal.ts"), /["'`]\/api\/focus/)).toEqual([]);
  });
  // P61: one registry builds every OS link (`@hub/contract/local`); only the server resolves a path (`@hub/projects/local-open`).
  it("no message:, mailto: or notion: link and no /usr/bin/open is written in the admin: the registry builds them", () => {
    expect(offenders(appFiles, /["'`](message|mailto|notion):|\/usr\/bin\/open/)).toEqual([]);
  });
  // P131 verdict 5: one destinations table (`@hub/contract/local`) and one opener (`lib/external.ts`, `components/open-link.tsx`):
  // no Notion, Telegram or WhatsApp host or scheme and no `target="_blank"` anywhere else, so no link guesses app or web on its own.
  it("no notion.so, notion.site, notion.com, t.me, wa.me, tg:, notion: or whatsapp: literal and no _blank target outside lib/external.ts", () => {
    const hosts = /notion\.so\b|notion\.site\b|notion\.com\b|\bt\.me\/|\bwa\.me\/|["'`](tg|notion|whatsapp):|_blank/;
    expect(offenders(appFiles.filter((p) => rel(p) !== "lib/external.ts"), hosts)).toEqual([]);
  });
  it("only lib/api/meta.ts posts to /api/local (lib/api holds eight files: the one call sits with the instance's)", () => {
    expect(offenders(appFiles.filter((p) => rel(p) !== "lib/api/meta.ts"), /["'`]\/api\/local/)).toEqual([]);
  });
  it("new EventSource and BroadcastChannel only in lib/cache/live.ts", () => {
    expect(offenders(appFiles.filter((p) => rel(p) !== "lib/cache/live.ts"), /new (EventSource|BroadcastChannel)\b/)).toEqual([]);
  });
});

describe("the generated API boundary", () => {
  it("features, components and hooks do not write raw JSON API paths", () => {
    const consumers = [...inDir("features"), ...inDir("components"), ...inDir("hooks")].filter((p) => rel(p) !== "features/shell/shell-frame.tsx");
    expect(offenders(consumers, /["'`]\/api\//)).toEqual([]);
  });
  it("generated client imports stay behind lib/api facades", () => {
    const deep = /from ["']@hub\/api\/(?:generated|src|zod)\b/;
    expect(offenders(appFiles, deep)).toEqual([]);
    expect(offenders(appFiles.filter((p) => !rel(p).startsWith("lib/api/")), /from ["']@hub\/api["']/)).toEqual([]);
  });
  it("every OpenAPI operation is public and recorded in the endpoint ledger", () => {
    const api = path.resolve(repo, "app/packages/api");
    const spec = read(path.join(api, "openapi.yaml"));
    const barrel = read(path.join(api, "src/index.ts"));
    const operations = [...spec.matchAll(/^\s+operationId:\s+([A-Za-z][A-Za-z0-9]+)\s*$/gm)].map((match) => match[1] ?? "");
    const ledger: readonly string[] = generatedOperations();
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.filter((operation) => !new RegExp(`\\b${operation}\\b`).test(barrel))).toEqual([]);
    expect(operations.filter((operation) => !ledger.includes(operation))).toEqual([]);
    expect(ledger.filter((operation) => !operations.includes(operation))).toEqual([]);
  });
  it("every raw facade path belongs to a ledger-owned API family", () => {
    const facades = [...walk(path.join(src, "lib/api"))].filter((p) => /\.tsx?$/.test(p));
    const paths = facades.flatMap((p) => [...read(p).matchAll(/["'`](\/api\/[^"'`]+)["'`]/g)].map((match) => ({ file: rel(p), value: match[1] ?? "" })));
    const families = new Set(rawPaths().map(apiFamily));
    expect(paths.filter(({ value }) => !families.has(apiFamily(value)))).toEqual([]);
  });
  it("the ledger names the sensitive project seams at endpoint level", () => {
    const required = [
      "/api/projects/:slug/drafts/:id/mail",
      "/api/projects/:slug/drafts/:id/mail/restore",
      "/api/projects/:slug/drafts/:id/send",
      "/api/projects/:slug/batches/:id/send",
      "/api/projects/:slug/batches/:id/send/stop",
      "/api/projects/:slug/messengers/drafts/:id/send",
      "/api/projects/:slug/messengers/autolink/*",
      "/api/projects/:slug/messengers/chats/*",
    ];
    const ledger: readonly string[] = rawPaths();
    expect(required.filter((endpoint) => !ledger.includes(endpoint))).toEqual([]);
  });
});

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
  // P49 S8: with the terminal, a script injected into the admin is a shell on the owner's Mac. Mail-derived text is rendered as text only.
  it("no dangerouslySetInnerHTML in the admin or in @hub/ui (rules: architecture-and-ownership 3)", () => {
    const ui = path.resolve(admin, "../../packages/ui/src");
    const files = [...appFiles, ...[...walk(ui)].filter((p) => /\.tsx?$/.test(p))];
    expect(files.filter((p) => /dangerouslySetInnerHTML/.test(code(p))).map((p) => path.relative(admin, p))).toEqual([]);
  });
  // P63 O2, decision 0035: the one exception. Mermaid's SVG is parsed and adopted in one file, loaded there by `import()` only.
  it("mermaid is imported only by features/help/scheme-svg.tsx, only through import(), and it is the one file that inserts parsed markup", () => {
    expect(offenders(appFiles, /from ["']mermaid["']|require\(["']mermaid["']\)/)).toEqual([]);
    expect(offenders(appFiles, /import\(["']mermaid["']\)/)).toEqual(["features/help/scheme-svg.tsx"]);
    expect(offenders(appFiles, /\.replaceChildren\(|DOMParser|insertAdjacentHTML|\.innerHTML\s*=|\.outerHTML\s*=/)).toEqual(["features/help/scheme-svg.tsx"]);
    const one = code(path.join(src, "features/help/scheme-svg.tsx"));
    expect(one).toContain('securityLevel: "strict"');
    expect(one).toContain('"image/svg+xml"');
    expect(one).not.toMatch(/innerHTML|insertAdjacentHTML|text\/html/);
  });
  // P81, standing rule 6 ("UI language: English"): every phrase, empty state and fix line the admin can show is written in the
  // admin, the contract or the server. One line is allowed: the Russian Re/Fwd subject prefixes the sent matcher strips.
  it("no Cyrillic in apps/admin/src, packages/contract/src or apps/server/src outside tests (rules README 6)", () => {
    const dirs = [src, path.join(repo, "app/packages/contract/src"), path.join(repo, "app/apps/server/src")];
    const lines = dirs.flatMap((d) =>
      [...walk(d)]
        .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))
        .flatMap((p) => read(p).split("\n").flatMap((l, i) => (/[Ѐ-ӿ]/.test(l) ? [`${path.relative(repo, p)}:${i + 1}`] : []))),
    );
    expect(lines.filter((l) => !/^app\/apps\/server\/src\/sent\.ts:\d+$/.test(l))).toEqual([]);
    expect(lines.filter((l) => l.startsWith("app/apps/server/src/sent.ts")).length).toBeLessThanOrEqual(1);
  });
  it("the Node-only server packages are banned imports: the eslint list names @hub/terminal and @hub/agent (P49) and @hub/sequences (P47), and no admin file imports them", () => {
    const config = read(path.join(admin, "eslint.config.mjs"));
    for (const name of ["sequences", "terminal", "agent"]) {
      expect(new RegExp(`const SERVER_PACKAGES = \\[[^\\]]*"${name}"[^\\]]*\\]`).test(config), name).toBe(true);
      expect(offenders(appFiles, new RegExp(`from ["']@hub/${name}(/|["'])`)), name).toEqual([]);
    }
  });
});

describe("shared UI ownership", () => {
  it("Mail and Messenger writing surfaces use the visual Markdown editor", () => {
    const composers = [...inDir("features/mail"), ...inDir("features/messengers")];
    expect(offenders(composers, /<Textarea\b|from ["']@hub\/ui\/textarea["']/)).toEqual([]);
    expect(composers.filter((p) => /(?:conversation\/pane|draft-block|chat-rules|draft-editor)\.tsx$/.test(rel(p)) && /<MarkdownEditor\b|<ConversationEditorSurface\b|<ConversationComposerEditor\b/.test(read(p))).length).toBeGreaterThan(0);
  });

  it("copied UI primitives do not import product behavior or domain packages", () => {
    const ui = path.resolve(repo, "app/packages/ui/src/ui");
    const files = [...walk(ui)].filter((p) => /\.tsx?$/.test(p));
    const forbidden = /from ["'](?:\.\.\/(?:product|use-hotkey|sound)|@hub\/(?:api|agent|config|contract|messengers|projects|send|server|terminal))/;
    expect(files.filter((p) => forbidden.test(read(p))).map((p) => path.relative(repo, p))).toEqual([]);
  });

  it("Storybook consumes public UI only and does not import admin runtime seams", () => {
    const storybook = path.resolve(repo, "app/apps/storybook");
    const files = [...walk(path.join(storybook, ".storybook")), ...walk(path.join(storybook, "src"))].filter((p) => /\.tsx?$/.test(p));
    const forbidden = /from ["'](?:@\/|@hub\/(?:agent|api|contract|messengers|projects|send|server)|\.\.\/\.\.\/admin)/;
    expect(files.filter((p) => forbidden.test(read(p))).map((p) => path.relative(repo, p))).toEqual([]);
  });

  // P123 U0 (`ui-composition.md` rule 8): the conversation composers are plain text until P93's RTF path lands.
  it("conversation editors are the plain-text editor in production and Storybook: no Markdown toolbar", () => {
    const composer = read(path.resolve(repo, "app/packages/ui/src/product/composer-editor.tsx"));
    expect(composer).toContain("<PlainTextEditor");
    expect(composer).not.toMatch(/MarkdownEditor|toolbarPreset/);
    const story = read(path.resolve(repo, "app/apps/storybook/src/stories/conversation-frame.stories.tsx"));
    expect(story).toContain("<PlainTextEditor");
    expect(story).not.toMatch(/<MarkdownEditor|toolbarPreset/);
  });
});

describe("bounded contract ownership", () => {
  it("Mail and review features do not reach the compatibility response barrel", () => {
    const bounded = [...inDir("features/review"), path.join(admin, "src/lib/api/review.ts"), path.join(admin, "src/lib/api/send.ts")];
    expect(offenders(bounded, /from ["']@hub\/contract\/responses["']/)).toEqual([]);
  });

  it("Mail and review contract subpaths remain public", () => {
    const contract = JSON.parse(read(path.resolve(repo, "app/packages/contract/package.json"))) as { exports?: Record<string, string> };
    expect(contract.exports?.["./mail"]).toBe("./src/mail.ts");
    expect(contract.exports?.["./review"]).toBe("./src/review.ts");
  });

  it("Messenger send doors do not import panel-only contracts", () => {
    const sendFiles = [
      path.join(admin, "src/lib/api/messengers/send.ts"),
      path.join(admin, "src/features/messengers/send-bar.tsx"),
      path.resolve(repo, "app/apps/server/src/routes/sends.ts"),
    ];
    expect(offenders(sendFiles, /from ["']@hub\/contract\/messenger-panel["']/)).toEqual([]);
  });
});

describe("the Next shell of the app", () => {
  const config = read(path.join(admin, "next.config.ts"));
  const pkg = JSON.parse(read(path.join(admin, "package.json"))) as { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> };
  it("the root layout is force-dynamic and mounts the ThemeProvider", () => {
    const layout = read(path.join(src, "app/layout.tsx"));
    expect(layout).toMatch(/export const dynamic = "force-dynamic"/);
    expect(layout).toContain("suppressHydrationWarning");
    expect(layout).not.toContain("dangerouslySetInnerHTML");
    expect(read(path.join(src, "app/providers.tsx"))).toMatch(/<ThemeProvider>/);
    // The theme is `@hub/ui/product/theme`'s alone: nothing else toggles the class or imports next-themes.
    expect(offenders(appFiles, /classList\.(toggle|add|remove)\(\s*["']dark["']|from ["']next-themes["']/)).toEqual([]);
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
  it("matchMedia is called only by `@hub/ui/use-media-query` (never in admin src)", () => {
    expect(offenders(appFiles, /\bmatchMedia\(/)).toEqual([]);
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

describe("test isolation", () => {
  const testRoots = [path.join(repo, "app", "apps"), path.join(repo, "app", "packages"), path.join(repo, "app", "test-support")];
  const testFiles = testRoots.flatMap((root) => [...walk(root)]).filter((p) => /\.test\.tsx?$/.test(p));

  it("every Vitest config installs the shared temporary root first", () => {
    const configs = testRoots.flatMap((root) => [...walk(root)]).filter((p) => p.endsWith("vitest.config.ts"));
    expect(configs.length).toBeGreaterThan(0);
    expect(configs.filter((p) => !read(p).match(/setupFiles:\s*\[\s*[\"'][^\"']*temp-root\.ts/)).map((p) => path.relative(repo, p))).toEqual([]);
  });

  it("every test that creates a temporary directory uses the process temp directory", () => {
    expect(testFiles.filter((p) => /mkdtempSync\(/.test(read(p)) && !/\btmpdir\(\)/.test(read(p))).map((p) => path.relative(repo, p))).toEqual([]);
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
    expect(text("routes-and-url-state.md")).toContain("`/lisbon/mail/c/ana%40example.com`");
    expect(text("routes-and-url-state.md")).toContain("defineRoute");
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

// Layout (P48, `admin-principles.md`): lists, tables and panes go full width; running prose takes the `measure` utility.
describe("layout", () => {
  it("no max-w- on a page or pane container", () => {
    // A named width (`max-w-4xl`, `max-w-screen-lg`, `max-w-prose`) is a page container; a percent on a control is not.
    const ui = path.resolve(admin, "../../packages/ui/src/product");
    const files = [...appFiles, ...walk(ui)];
    expect(files.filter((p) => /\bmax-w-(\d?xl|xs|sm|md|lg|screen|prose|\d)/.test(code(p))).map((p) => path.relative(admin, p))).toEqual([]);
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
