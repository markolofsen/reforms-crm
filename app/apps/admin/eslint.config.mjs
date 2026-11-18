// Frontend rules gate (`app/@rules`). Every rule is an error.
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";
import tseslint from "typescript-eslint";
import { FILE_LINE_CAP, FUNCTION_LINE_CAP, LINE_COUNT } from "@hub/config/lint-limits";

const error = (rules) => Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, Array.isArray(v) ? ["error", ...v] : ["error", v]]));

// Markup bans (rules: design-system-and-tokens) and URL bans (rules: routes-and-url-state 14).
const MARKUP = [
  { selector: "JSXOpeningElement[name.name='button']", message: "Use ActionButton from @hub/ui/product/action-button (rules: design-system-and-tokens 3)." },
  { selector: "JSXOpeningElement[name.name='a']", message: "Use AppLink for an internal link (rules: routes-and-url-state 2)." },
  { selector: "JSXOpeningElement[name.name=/^(input|select|textarea)$/]", message: "Use the coss field primitives (rules: design-system-and-tokens 3)." },
];
const URL_WORDS = "Destinations come from `paths.*` in src/routes/paths.ts and render with AppLink or move with useGo (rules: routes-and-url-state 1-2).";
const URLS = [
  { selector: "JSXAttribute[name.name=/^(href|to)$/] > Literal[value=/^\\//]", message: `No string href/to. ${URL_WORDS}` },
  { selector: "JSXAttribute[name.name=/^(href|to)$/] > JSXExpressionContainer > Literal[value=/^\\//]", message: `No string href/to. ${URL_WORDS}` },
  { selector: "JSXAttribute[name.name=/^(href|to)$/] > JSXExpressionContainer > TemplateLiteral[quasis.0.value.raw=/^\\//]", message: `No template href/to. ${URL_WORDS}` },
  { selector: "CallExpression[callee.name=/^(go|navigate)$/] > Literal.arguments:first-child", message: `No string address. ${URL_WORDS}` },
  { selector: "CallExpression[callee.name=/^(go|navigate)$/] > TemplateLiteral.arguments:first-child", message: `No string address. ${URL_WORDS}` },
  { selector: "MemberExpression[object.name='window'][property.name=/^(location|history)$/]", message: "The address bar is touched only in src/hooks/use-search-state.ts and src/lib/external.ts." },
  { selector: "AssignmentExpression[left.object.name='document'][left.property.name='title']", message: "The title is Next metadata (`metadata`/`generateMetadata`), never `document.title =`." },
];
const STORAGE_GLOBALS = [
  { name: "localStorage", message: "Storage goes through one module (rules: state-and-data 7)." },
  { name: "sessionStorage", message: "Storage goes through one module (rules: state-and-data 7)." },
];
const BASE_GROUP = ["@radix-ui/*", "@headlessui/*"];
// `sequences` (P47): the follow-up rules are the server's; the admin reads them through /api. `terminal` and `agent` (P49) are
// Node only (the PTY, the socket, the agent checks): the admin reaches them through /api and the socket, never by import.
const SERVER_PACKAGES = ["db", "mail", "notion", "send", "messengers", "projects", "sequences", "terminal", "agent", "server"];
const SERVER_MESSAGE = "The admin talks to the server over /api only; @hub/server is imported as `import type` (decision 0015 section 4).";
const BASE_IMPORTS = {
  paths: ["clsx", "tailwind-merge"].map((name) => ({ name, message: "Use `cn` from @hub/ui/cn." })),
  patterns: [{ group: BASE_GROUP, message: "Use the coss primitives (rules: design-system-and-tokens 1)." }],
};
const BUTTON = { name: "@hub/ui/button", message: "Use ActionButton (@hub/ui/product/action-button): three sizes, four variants (rules: design-system-and-tokens 3)." };
// Next's navigation is used only where an address is read or moved: the link, the hooks, and the route files themselves.
const NEXT_NAV = ["next/link", "next/navigation", "next/router"].map((name) => ({ name, message: "Use AppLink and the hooks in src/hooks (use-go, use-search-state); next/* navigation is imported only in src/app, src/hooks and src/components/app-link.tsx." }));
// The Hono server owns the database and the mail (decision 0015 section 4): the admin imports only types of the contract.
const SERVER_SIDE = SERVER_PACKAGES.map((p) => ({ name: `@hub/${p}`, message: SERVER_MESSAGE }));
const SERVER_SUBPATHS = { group: SERVER_PACKAGES.map((p) => `@hub/${p}/*`), message: SERVER_MESSAGE };

// "use server" is banned everywhere in src (the package holds the same ban in packages/ui/eslint.config.mjs).
const USE_SERVER = { selector: "Literal[value='use server']", message: "No Server Actions (decision 0015): every write goes through the Hono API." };

export default tseslint.config(
  { ignores: ["*.d.mts", ".next", ".next-e2e", ".next-build-check", "next-env.d.ts", "test-results", "playwright-report", "node_modules"] },
  ...nextVitals,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: { allowDefaultProject: [] }, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": "allow-with-description" }],
      "jsx-a11y/alt-text": "error",
      ...error({
        "@typescript-eslint/no-non-null-assertion": [],
        "@typescript-eslint/consistent-type-assertions": [{ assertionStyle: "never" }],
        "@typescript-eslint/consistent-type-imports": [{ fixStyle: "inline-type-imports" }],
        "@typescript-eslint/no-floating-promises": [],
        "@typescript-eslint/no-misused-promises": [],
        "max-lines": [{ max: FILE_LINE_CAP, ...LINE_COUNT }],
        "max-lines-per-function": [{ max: FUNCTION_LINE_CAP, ...LINE_COUNT }],
        "no-restricted-globals": [
          ...STORAGE_GLOBALS,
          { name: "location", message: "The address bar is touched only in src/hooks/use-search-state.ts and src/lib/external.ts." },
          { name: "history", message: "The address bar is touched only in src/hooks/use-search-state.ts and src/lib/external.ts." },
        ],
        "no-restricted-properties": [
          { object: "Date", property: "now", message: "Inject a clock; render stays deterministic (rules: ui-specifications 2)." },
          { object: "Math", property: "random", message: "No randomness in render (rules: ui-specifications 2)." },
        ],
        "no-restricted-syntax": [...MARKUP, ...URLS, USE_SERVER],
        "no-restricted-imports": [{ paths: [...BASE_IMPORTS.paths, ...NEXT_NAV, ...SERVER_SIDE, BUTTON], patterns: [...BASE_IMPORTS.patterns, SERVER_SUBPATHS] }],
      }),
    },
  },
  // The modules that may use next/link, next/navigation and next/router: the route files, the hooks and AppLink.
  {
    files: ["src/app/**", "src/hooks/**", "src/components/app-link.tsx"],
    rules: { "no-restricted-imports": ["error", { paths: [...BASE_IMPORTS.paths, ...SERVER_SIDE, BUTTON], patterns: [...BASE_IMPORTS.patterns, SERVER_SUBPATHS] }] },
  },
  // The one hook that writes the query string in place (shallow, no server round trip: P32 N0) and the one external opener.
  {
    files: ["src/hooks/use-search-state.ts", "src/lib/external.ts"],
    rules: {
      "no-restricted-globals": ["error", ...STORAGE_GLOBALS],
      "no-restricted-syntax": ["error", ...MARKUP, ...URLS.filter((u) => !u.selector.startsWith("MemberExpression"))],
    },
  },
  // `routes/` is pure data and types: no React, no component, no feature, no navigation library. `import type` from `next` is allowed (typed routes).
  {
    files: ["src/routes/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...BASE_IMPORTS.paths, ...SERVER_SIDE, BUTTON, ...["react", "react-dom", "next/link", "next/navigation", "next/router"].map((name) => ({ name, message: "src/routes is pure data and types (rules: routes-and-url-state 14)." }))],
          patterns: [SERVER_SUBPATHS, { group: [...BASE_GROUP, "@/components/*", "@/features/*", "@/hooks/*", "react/*"], message: "src/routes imports no React, component, feature or hook." }],
        },
      ],
    },
  },
  // Node-side files: configs, tests, proxy.
  {
    files: ["*.config.{ts,mjs}", "e2e/**", "test/**", "src/**/*.test.{ts,tsx}", "src/proxy.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
