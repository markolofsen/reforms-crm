import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { useMediaQuery } from "@hub/ui/use-media-query";
import { PROJECT_COOKIE } from "@/routes/guards";
import { NO_SHELL_PREFS, SHELL_COOKIE, atLeast, breakpointOf, formatShellPrefs, parseShellPrefs, type ShellBreakpoint, type ShellPrefs } from "./shell-prefs";

// The one module that touches browser storage and the one project cookie. Both can throw or come back empty (private
// window, blocked site data), so every read and write is guarded and the page works without them. Only per-viewer
// conveniences live here. A value is read through `useStored` / `useRememberedProject`: the server snapshot is `null`, so
// the first render is the same on the server and in the browser (hydration), and the remembered value arrives right after.
// The terminal's active tab (P49) is a viewing preference, not screen state; its open state and width are in the shell cookie
// below (P128 X8), with the rail's pin, because the server lays them out. Quick Links keeps its shell disclosure and each expanded group separately; `sound` (P59) is the agent feed's mute switch,
// "off" when muted; the sound is on by default.
// `leads-seen` (P138 verdict 6): per project, the newest lead the last visit and this one saw, for the "new since last visit" dot.
const KEYS = { shortcuts: "hub.shortcuts", "terminal-tab": "hub.terminal-tab", sound: "hub.sound", "leads-seen": "hub.leads-seen" } as const;
type Key = keyof typeof KEYS;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((cb) => cb());
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function load(key: Key): string | null {
  try {
    return window.localStorage.getItem(KEYS[key]);
  } catch {
    return null;
  }
}

export function save(key: Key, value: string): void {
  try {
    window.localStorage.setItem(KEYS[key], value);
  } catch {
    /* not remembered */
  }
  notify();
}

/** A stored value as state: `null` on the server and in the first client render, the real one after. */
export function useStored(key: Key): string | null {
  return useSyncExternalStore(subscribe, () => load(key), () => null);
}

// The remembered project of a multi-project instance (for a bare `/mail`). A cookie, not localStorage, as before P48; it is
// not a secret and the server is loopback only.
function readCookie(name: string): string | null {
  try {
    const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string): void {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* not remembered */
  }
  notify();
}

const readProject = (): string | null => readCookie(PROJECT_COOKIE);

export function saveProject(project: string): void {
  writeCookie(PROJECT_COOKIE, project);
}

export function useRememberedProject(): string | null {
  return useSyncExternalStore(subscribe, readProject, () => null);
}

// P128 X8: the shell's layout preferences (`lib/shell-prefs.ts`), one cookie the shell layout also reads on the server. The
// server's parse is handed down as `ShellPrefsContext` and is the server snapshot, so the first client render is the
// server's, and it already matches the last page: rail or open sidebar, the terminal column at its width, no jump.
export const ShellPrefsContext = createContext<ShellPrefs>(NO_SHELL_PREFS);

let shellRaw: string | null = null;
let shellParsed: ShellPrefs = NO_SHELL_PREFS;
/** The cookie's preferences, the same object while the cookie's text is the same (a `useSyncExternalStore` snapshot). */
function readShell(): ShellPrefs {
  const raw = readCookie(SHELL_COOKIE);
  if (raw !== shellRaw) {
    shellRaw = raw;
    shellParsed = parseShellPrefs(raw);
  }
  return shellParsed;
}

/** Written on change: the pin, the column opened or closed, a resize, a new breakpoint. */
export function saveShell(change: Partial<ShellPrefs>): void {
  const next = { ...readShell(), ...change };
  writeCookie(SHELL_COOKIE, formatShellPrefs(next));
}

/** The shell's preferences: the server's read in the first render, the browser's cookie after. */
export function useShellPrefs(): ShellPrefs {
  const server = useContext(ShellPrefsContext);
  return useSyncExternalStore(subscribe, readShell, () => server);
}

/** `useMediaQuery(min)` whose server answer is the remembered breakpoint (unknown: false, as before X8). */
export function useAtLeast(min: Exclude<ShellBreakpoint, "phone">): boolean {
  return useMediaQuery(min, atLeast(useShellPrefs().bp, min));
}

/** The shell remembers the breakpoint it is at, so the next request's server render guesses the viewport right. */
export function useRememberBreakpoint(): void {
  useEffect(() => {
    const check = () => {
      const bp = breakpointOf(window.innerWidth);
      if (readShell().bp !== bp) saveShell({ bp });
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
}
