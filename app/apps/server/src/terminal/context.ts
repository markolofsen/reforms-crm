import type { TerminalService } from "./terminal";

/** The embedded terminal's context (P49); absent, its routes are 404. */
export type TerminalContext = { terminal?: TerminalService; adminPort: number };
