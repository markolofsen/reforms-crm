"use client";

import { useCallback, useSyncExternalStore } from "react";

const BREAKPOINTS = {
  "2xl": 1536,
  "3xl": 1600,
  "4xl": 2000,
  lg: 1024,
  // Product edit of the coss copy: `md` is where the sidebar stops being a rail and becomes a phone's tab bar. Phones are
  // below 640px; a tablet (640-1023) keeps the rail and shows the list and the detail as separate screens (`design-system-and-tokens.md` rule 13).
  md: 640,
  sm: 640,
  xl: 1280,
} as const;

type Breakpoint = keyof typeof BREAKPOINTS;

type BreakpointQuery =
  | Breakpoint
  | `max-${Breakpoint}`
  | `${Breakpoint}:max-${Breakpoint}`;

function resolveMin(value: Breakpoint | number): string {
  const px = typeof value === "number" ? value : BREAKPOINTS[value];
  return `(min-width: ${px}px)`;
}

function resolveMax(value: Breakpoint | number): string {
  const px = typeof value === "number" ? value : BREAKPOINTS[value];
  return `(max-width: ${px - 1}px)`;
}

function parseQuery(
  query: BreakpointQuery | MediaQueryInput | (string & {}),
): string {
  if (typeof query !== "string") {
    const parts: string[] = [];
    if (query.min != null) parts.push(resolveMin(query.min));
    if (query.max != null) parts.push(resolveMax(query.max));
    if (query.pointer === "coarse") parts.push("(pointer: coarse)");
    if (query.pointer === "fine") parts.push("(pointer: fine)");
    if (parts.length === 0) return "(min-width: 0px)";
    return parts.join(" and ");
  }

  if (query.startsWith("(")) return query;

  const parts: string[] = [];
  for (const segment of query.split(":")) {
    if (segment.startsWith("max-")) {
      const bp = segment.slice(4);
      if (bp in BREAKPOINTS) parts.push(resolveMax(bp as Breakpoint));
    } else if (segment in BREAKPOINTS) {
      parts.push(resolveMin(segment as Breakpoint));
    }
  }

  return parts.length > 0 ? parts.join(" and ") : query;
}

export type MediaQueryInput = {
  min?: Breakpoint | number;
  max?: Breakpoint | number;
  /** Touch-like input (finger). Use "fine" for mouse/trackpad. */
  pointer?: "coarse" | "fine";
};

/**
 * Whether the viewport matches. The server has no viewport: `serverMatches` (false by default) is the answer of the server
 * render and of the first client render (hydration); a consumer that remembers the last viewport (the admin's shell cookie,
 * P128 X8) passes its guess, so a right guess changes nothing after hydration.
 */
export function useMediaQuery(
  query: BreakpointQuery | MediaQueryInput | (string & {}),
  serverMatches = false,
): boolean {
  const mediaQuery = parseQuery(query);

  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(mediaQuery);
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    [mediaQuery],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(mediaQuery).matches;
  }, [mediaQuery]);

  return useSyncExternalStore(subscribe, getSnapshot, () => serverMatches);
}

export function useIsMobile(): boolean {
  return useMediaQuery("max-md");
}
