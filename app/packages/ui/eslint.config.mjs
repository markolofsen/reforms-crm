// The package's gate (`app/@rules`). The coss copies in src/ui are not hand-edited: only the typing bans, the server bans and the
// direction rule apply to them; the hand-written files (src/product, cn) get every rule of the admin's typing and size caps.
import { FILE_LINE_CAP, FUNCTION_LINE_CAP, LINE_COUNT } from "@hub/config/lint-limits";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const error = (rules) => Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, Array.isArray(v) ? ["error", ...v] : ["error", v]]));
const UI = "src/ui/**";
const USE_SERVER = { selector: "Literal[value='use server']", message: "No Server Actions (decision 0015): every write goes through the Hono API." };
// The package imports no app and no server package: only react, Base UI, lucide and itself (rules: architecture-and-ownership 2).
const DIRECTION = {
  paths: [],
  patterns: [
    { group: ["@hub/*", "@/*", "next", "next/*"], message: "@hub/ui imports no app, no @hub package and no Next module (rules: architecture-and-ownership 2)." },
    { group: ["@radix-ui/*", "@headlessui/*"], message: "Use the coss primitives (rules: design-system-and-tokens 1)." },
  ],
};
const MERGE = ["clsx", "tailwind-merge"].map((name) => ({ name, message: "Use `cn` (src/cn.ts)." }));

export default tseslint.config(
  { ignores: ["node_modules"] },
  tseslint.configs.base,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    languageOptions: { globals: globals.browser, parserOptions: { projectService: { allowDefaultProject: [] }, tsconfigRootDir: import.meta.dirname } },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": "allow-with-description" }],
      ...error({
        "@typescript-eslint/no-non-null-assertion": [],
        "@typescript-eslint/consistent-type-assertions": [{ assertionStyle: "never" }],
        "@typescript-eslint/consistent-type-imports": [{ fixStyle: "inline-type-imports" }],
        "@typescript-eslint/no-floating-promises": [],
        "@typescript-eslint/no-misused-promises": [],
        "max-lines": [{ max: FILE_LINE_CAP, ...LINE_COUNT }],
        "max-lines-per-function": [{ max: FUNCTION_LINE_CAP, ...LINE_COUNT }],
        "no-restricted-properties": [
          { object: "Date", property: "now", message: "Inject a clock; render stays deterministic (rules: ui-specifications 2)." },
          { object: "Math", property: "random", message: "No randomness in render (rules: ui-specifications 2)." },
        ],
        "no-restricted-syntax": [USE_SERVER],
        "no-restricted-imports": [{ ...DIRECTION, paths: MERGE }],
      }),
    },
  },
  // coss files are copied from the registry and not hand-edited: the typing bans and the direction rule only.
  {
    files: [UI],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      ...Object.fromEntries(
        ["react-hooks/purity", "@typescript-eslint/no-floating-promises", "@typescript-eslint/no-misused-promises", "max-lines", "max-lines-per-function", "no-restricted-properties", "@typescript-eslint/consistent-type-assertions", "@typescript-eslint/no-non-null-assertion", "jsx-a11y/no-autofocus"].map((r) => [r, "off"]),
      ),
      "no-restricted-imports": ["error", { ...DIRECTION, paths: MERGE }],
    },
  },
  // `use-media-query` is a coss copy with one product edit; `cn` is the one place that imports clsx and tailwind-merge.
  { files: ["src/use-media-query.ts"], linterOptions: { reportUnusedDisableDirectives: "off" }, rules: { "max-lines": "off", "max-lines-per-function": "off", "react-hooks/purity": "off", "@typescript-eslint/no-non-null-assertion": "off", "@typescript-eslint/consistent-type-assertions": "off", "no-restricted-properties": "off" } },
  { files: ["src/cn.ts"], rules: { "no-restricted-imports": ["error", DIRECTION] } },
  { files: ["test/**", "*.config.{ts,mjs}"], languageOptions: { globals: { ...globals.node } } },
);
