// The shared base (P121 T2, `@hub/config/eslint`); `render.ts` runs in the browser.
import { hubLint } from "@hub/config/eslint";

export default hubLint(import.meta.dirname, { browser: true });
