// The shared base (P121 T2, `@hub/config/eslint`).
import { hubLint } from "./src/eslint.mjs";

export default hubLint(import.meta.dirname);
