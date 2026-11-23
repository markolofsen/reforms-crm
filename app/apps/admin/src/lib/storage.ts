import { useSyncExternalStore } from "react";
import { PROJECT_COOKIE } from "@/routes/guards";

// The one module that touches browser storage and the one project cookie. Both can throw or come back empty (private
// window, blocked site data), so every read and write is guarded and the page works without them. Only per-viewer
// conveniences live here. A value is read through `useStored` / `useRememberedProject`: the server snapshot is `null`, so
// the first render is the same on the server and in the browser (hydration), and the remembered value arrives right after.
// The terminal's three (P49) are a viewing preference, not screen state: open or closed, the column's width, the active tab.
// Quick Links keeps its shell disclosure and each expanded group separately; `sound` (P59) is the agent feed's mute switch,
// "off" when muted; the sound is on by default.
const KEYS = { shortcuts: "hub.shortcuts", rail: "hub.rail", terminal: "hub.terminal", "terminal-width": "hub.terminal-width", "terminal-tab": "hub.terminal-tab", "quick-links": "hub.quick-links", "quick-links-groups": "hub.quick-links-groups", sound: "hub.sound" } as const;
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
function readProject(): string | null {
  try {
    const hit = document.cookie.split("; ").find((c) => c.startsWith(`${PROJECT_COOKIE}=`));
    return hit ? decodeURIComponent(hit.slice(PROJECT_COOKIE.length + 1)) : null;
  } catch {
    return null;
  }
}

export function saveProject(project: string): void {
  try {
    document.cookie = `${PROJECT_COOKIE}=${encodeURIComponent(project)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* not remembered */
  }
  notify();
}

export function useRememberedProject(): string | null {
  return useSyncExternalStore(subscribe, readProject, () => null);
}
