import { randomBytes } from "node:crypto";
import { ALLOWED_HOSTNAMES } from "@hub/config";

// The two doors that need a person at the admin tab, not just a loopback caller (P49 S4, S5, S12): the manual Send and
// the terminal. The API's general guard admits any loopback Origin on any port; these admit only the admin's own origin,
// and only with a single-use ticket that page fetched a moment before. Headers can be forged by an unsandboxed local
// process, so this raises the bar; the OS sandbox of an unattended agent is the boundary (it cannot reach loopback).

/** `http://127.0.0.1:<admin port>` and `http://localhost:<admin port>`: the only origins of the admin page. */
export const adminOrigins = (adminPort: number): string[] => ["127.0.0.1", "localhost"].map((h) => `http://${h}:${adminPort}`);

export interface GateHeaders {
  origin?: string | undefined;
  host?: string | undefined;
  secFetchSite?: string | undefined;
}

/**
 * Why a request may not open the door, or null. Exact admin Origin (a missing or `null` one is refused), a loopback
 * Host (DNS rebinding), and, when `sameSite` is asked, `Sec-Fetch-Site: same-origin` (a browser sets it; a page on
 * another port is `same-site`).
 */
export function gateRefusal(h: GateHeaders, adminPort: number, o: { sameSite: boolean }): string | null {
  const host = (h.host ?? "").replace(/:\d+$/, "");
  if (!(ALLOWED_HOSTNAMES as readonly string[]).includes(host)) return "the Host is not a loopback name";
  if (!h.origin || !adminOrigins(adminPort).includes(h.origin)) return "only the admin page may open this";
  if (o.sameSite && h.secFetchSite !== "same-origin") return "only the admin page may open this (Sec-Fetch-Site)";
  return null;
}

export interface Ticket { ticket: string; expiresAt: string }

/**
 * Single-use tickets bound to one subject (a draft id, a terminal session), valid `ttlMs`. In memory only, so a
 * server restart voids every ticket. 32 random bytes, base64url.
 */
export function ticketStore(o: { ttlMs: number; now?: () => number; max?: number }) {
  const now = o.now ?? Date.now;
  const live = new Map<string, { subject: string; until: number }>();
  const sweep = () => {
    const t = now();
    for (const [k, v] of live) if (v.until <= t) live.delete(k);
  };
  return {
    mint(subject: string): Ticket {
      sweep();
      // A page that mints and never uses cannot grow the map without bound.
      if (live.size >= (o.max ?? 64)) live.delete(live.keys().next().value as string);
      const ticket = randomBytes(32).toString("base64url");
      const until = now() + o.ttlMs;
      live.set(ticket, { subject, until });
      return { ticket, expiresAt: new Date(until).toISOString() };
    },
    /** The subject a live ticket was minted for, once; null for an unknown or expired one. Spends it either way. */
    redeem(ticket: string): string | null {
      const t = live.get(ticket);
      live.delete(ticket);
      return t && t.until > now() ? t.subject : null;
    },
    /** True once: the ticket exists, is not expired and names this subject. Any use, right or wrong, spends it. */
    take(ticket: string | undefined, subject: string): boolean {
      if (!ticket) return false;
      const t = live.get(ticket);
      live.delete(ticket);
      return !!t && t.until > now() && t.subject === subject;
    },
  };
}
export type TicketStore = ReturnType<typeof ticketStore>;
