// P121 T2: the one ESLint base. A Node workspace's `eslint.config.mjs` is `export default hubLint(import.meta.dirname);` (plus
// `{ browser: true }` for Storybook); the admin and @hub/ui keep their own markup, URL and direction bans and take the shared typing
// and size rules from here. Every rule is an error (`app/@rules/verification.md` rule 5).
import path from "node:path";
import { fileURLToPath } from "node:url";
import globals from "globals";
import tseslint from "typescript-eslint";
import { FILE_LINE_CAP, FUNCTION_LINE_CAP, LINE_COUNT } from "./lint-limits.mjs";

/** `app/`, the root the ratchet's paths are written from. */
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// The ratchet (P121 verdict 2): source files over FILE_LINE_CAP when lint first ran everywhere, each with its count on that day
// (lines as LINE_COUNT counts them). The number is the file's own cap: it may go down, never up; a file split under the cap
// leaves the list (`packages/config/test/lint-ratchet.test.ts` fails while it is listed). Never add a file to this list: split it.
export const FILE_RATCHET = {
  "apps/storybook/src/stories/conversation-frame.stories.tsx": 337,
  "apps/server/src/messengers/autolink/autolink.ts": 328,
  "packages/messengers/src/whatsapp.ts": 318,
  "packages/projects/src/parse.ts": 304,
  "packages/projects/src/commands.ts": 302,
};

// The same for functions over FUNCTION_LINE_CAP: `"<file>": <longest function's lines>`. Filled once by the first full lint run
// (the final gate of P130), from its `max-lines-per-function` errors; empty until then.
export const FUNCTION_RATCHET = {};

/** The typing rules every workspace holds (the admin and @hub/ui add the assertion bans of their own pages). */
export const TYPING_RULES = {
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": "allow-with-description" }],
  "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
};

/** The rules that need type information (a file inside the workspace's tsconfig). */
export const TYPED_RULES = {
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
};

/** The size caps of `app/@rules/structure-and-naming.md` rules 2 and 3. */
export const SIZE_RULES = {
  "max-lines": ["error", { max: FILE_LINE_CAP, ...LINE_COUNT }],
  "max-lines-per-function": ["error", { max: FUNCTION_LINE_CAP, ...LINE_COUNT }],
};

const rel = (dirname) => path.relative(APP_ROOT, dirname).split(path.sep).join("/");

/** One override per ratchet entry inside `dirname`: that file's cap is its listed count. */
export function ratchetFor(dirname) {
  const here = `${rel(dirname)}/`;
  const files = (table) => Object.entries(table).filter(([file]) => file.startsWith(here));
  return [
    ...files(FILE_RATCHET).map(([file, max]) => ({ files: [file.slice(here.length)], rules: { "max-lines": ["error", { max, ...LINE_COUNT }] } })),
    ...files(FUNCTION_RATCHET).map(([file, max]) => ({ files: [file.slice(here.length)], rules: { "max-lines-per-function": ["error", { max, ...LINE_COUNT }] } })),
  ];
}

const IGNORES = ["node_modules", "dist", "storybook-static", "drizzle", "src/generated", "**/*.d.ts", "**/*.d.mts", "templates", "fixtures"];
const SOURCE = ["src/**/*.{ts,tsx,mts}"];
const TESTS = ["test/**/*.{ts,tsx}", "eval/**/*.ts", "src/**/*.test.{ts,tsx}", "src/test-support/**", "src/testing/**", "src/**/testing.ts"];

/**
 * The config of a workspace without its own page of bans: typing everywhere, typed rules and the size caps in `src` (tests are
 * exempt from the caps, as in the admin), the ratchet over the files listed for this workspace.
 * @param {string} dirname the workspace's folder (`import.meta.dirname`)
 * @param {{ browser?: boolean }} [options] browser globals (Storybook)
 */
export function hubLint(dirname, options = {}) {
  const env = options.browser ? { ...globals.browser, ...globals.node } : globals.node;
  return tseslint.config(
    { ignores: IGNORES },
    tseslint.configs.base,
    { files: ["**/*.{ts,tsx,mts,mjs}"], languageOptions: { globals: env }, rules: TYPING_RULES },
    {
      files: SOURCE,
      ignores: TESTS,
      languageOptions: { parserOptions: { projectService: { allowDefaultProject: [] }, tsconfigRootDir: dirname } },
      rules: { ...TYPED_RULES, ...SIZE_RULES },
    },
    ...ratchetFor(dirname),
  );
}
