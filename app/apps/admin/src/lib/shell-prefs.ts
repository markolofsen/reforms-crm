// P128 X8: the shell's layout preferences as one small cookie, so the server renders the first paint the way the last page
// ended and a cold load does not jump. Pure (no React, no `document`): the shell layout parses the request's cookie on the
// server, `lib/storage.ts` reads and writes `document.cookie` in the browser, and both go through these two functions.
// A viewing preference, not data and not screen state: the rail's pin, whether the terminal column was open and its width,
// and the last breakpoint the browser was at (the server has no viewport; this is its best guess of one).

export const SHELL_COOKIE = "hub_shell";

/** The viewport buckets the shell lays out by: below 640px a phone, 640 the rail, 1024 the docked terminal, 1280 the open sidebar, 1600 room for both. */
export const SHELL_BREAKPOINTS = { phone: 0, md: 640, lg: 1024, xl: 1280, "3xl": 1600 } as const;
export type ShellBreakpoint = keyof typeof SHELL_BREAKPOINTS;

export type ShellPrefs = {
  /** The person's pin of the sidebar; null: the width decides (open from 1280px). */
  readonly rail: "open" | "closed" | null;
  /** The terminal column was open when the last page ended (restored from 1024px). */
  readonly dock: boolean;
  /** The column's saved width in px; null: the default. */
  readonly width: number | null;
  /** The last breakpoint seen; null: never measured (the server then lays out as before, narrowest first). */
  readonly bp: ShellBreakpoint | null;
};

export const NO_SHELL_PREFS: ShellPrefs = { rail: null, dock: false, width: null, bp: null };

const BREAKPOINT_NAMES: readonly string[] = Object.keys(SHELL_BREAKPOINTS);
const isBreakpoint = (v: string): v is ShellBreakpoint => BREAKPOINT_NAMES.includes(v);

/** The cookie's value (`rail-open.dock-open.w-480.bp-xl`) back to preferences; anything unreadable is left at its default. */
export function parseShellPrefs(raw: string | null | undefined): ShellPrefs {
  if (!raw) return NO_SHELL_PREFS;
  let rail: ShellPrefs["rail"] = null;
  let dock = false;
  let width: number | null = null;
  let bp: ShellBreakpoint | null = null;
  for (const part of raw.split(".")) {
    const [k, v = ""] = part.split("-", 2);
    if (k === "rail" && (v === "open" || v === "closed")) rail = v;
    else if (k === "dock") dock = v === "open";
    else if (k === "w" && /^\d{1,5}$/.test(v)) width = Number(v) > 0 ? Number(v) : null;
    else if (k === "bp" && isBreakpoint(v)) bp = v;
  }
  return { rail, dock, width, bp };
}

/** Preferences as the cookie's value: only what is set, cookie-safe characters only. */
export function formatShellPrefs(p: ShellPrefs): string {
  const parts: string[] = [];
  if (p.rail) parts.push(`rail-${p.rail}`);
  if (p.dock) parts.push("dock-open");
  if (p.width !== null && Number.isFinite(p.width) && p.width > 0) parts.push(`w-${Math.round(p.width)}`);
  if (p.bp) parts.push(`bp-${p.bp}`);
  return parts.join(".");
}

/** The bucket a viewport this wide is in. */
export function breakpointOf(width: number): ShellBreakpoint {
  if (width >= SHELL_BREAKPOINTS["3xl"]) return "3xl";
  if (width >= SHELL_BREAKPOINTS.xl) return "xl";
  if (width >= SHELL_BREAKPOINTS.lg) return "lg";
  if (width >= SHELL_BREAKPOINTS.md) return "md";
  return "phone";
}

/** Whether the remembered breakpoint is at least `min`: the server's answer to `useMediaQuery(min)`. Unknown is false, as before. */
export function atLeast(bp: ShellBreakpoint | null, min: Exclude<ShellBreakpoint, "phone">): boolean {
  return bp !== null && SHELL_BREAKPOINTS[bp] >= SHELL_BREAKPOINTS[min];
}
