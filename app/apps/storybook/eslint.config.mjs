// The shared base (P121 T2, `@hub/config/eslint`).
import { hubLint } from "@hub/config/eslint";

export default hubLint(import.meta.dirname, { browser: true });
