// P155: the booking link that pulls a client to a call. Which link a thread may carry (the brand's, else the project's, else
// none), whether it was offered already, and the narrow check at the agent's write. Pure: the hub MCP tools, the server's
// prefetches and the doctor call the same functions.
import type { Brand } from "../schema";

/** The cell or setting value that says "never offer one". */
export const BOOKING_NONE = "none";

/**
 * Scheduler hosts whose links the check of verdict 8 recognises (a host or any subdomain of it). A Google appointment page on
 * `calendar.google.com` counts only under `/calendar/appointments`; HubSpot's are `meetings*.hubspot.com`.
 */
export const SCHEDULER_HOSTS = ["calendly.com", "cal.com", "calendar.app.google", "savvycal.com", "tidycal.com", "zcal.co"] as const;

/** A booking value as the Settings cell and the `Booking` column accept it: one https URL with a host, no spaces. */
export function bookingValueIssue(value: string): string | null {
  const v = value.trim();
  if (v === BOOKING_NONE) return null;
  if (v.length > 2048 || /\s/.test(v)) return `expected one https URL or none, got "${v.slice(0, 80)}"`;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return `expected an https URL or none, got "${v.slice(0, 80)}"`;
    return null;
  } catch {
    return `expected an https URL or none, got "${v.slice(0, 80)}"`;
  }
}

/** The empty cell is null; `none` and a URL are kept as written (trimmed). */
export const bookingCell = (cell: string): string | null => (cell.trim() === "" ? null : cell.trim());

export interface BookingConfig {
  booking: { url: string | null };
  brands: readonly Pick<Brand, "name" | "booking">[];
}

export type BookingSource = "brand" | "project" | "none" | "unresolved";

/** The link a brand offers (its own, else the project's), or null with why. */
export interface BookingLink {
  url: string | null;
  source: BookingSource;
  reason: string;
}

const real = (v: string | null | undefined): string | null => (v && v.trim() !== BOOKING_NONE && bookingValueIssue(v) === null ? v.trim() : null);

/** The link of one brand row: its own cell, `none`, or (empty) the project's default. */
function ofRow(c: BookingConfig, row: Pick<Brand, "name" | "booking">): BookingLink {
  const cell = row.booking?.trim() ?? "";
  if (cell === BOOKING_NONE) return { url: null, source: "none", reason: `brand ${row.name} offers no booking link (Booking: none)` };
  if (real(cell)) return { url: cell, source: "brand", reason: `brand ${row.name}'s own booking link` };
  const project = real(c.booking.url);
  return project ? { url: project, source: "project", reason: `the project's booking.url (brand ${row.name} names none of its own)` } : { url: null, source: "none", reason: `no booking link is set for brand ${row.name} or the project` };
}

/**
 * Verdict 4: the thread's brand → its `Booking` → `booking.url` → none. A brand that is not resolved (many messenger chats) gets
 * the one link every brand shares, or none when the brands' links differ: never the project default by itself.
 */
export function bookingLinkOf(c: BookingConfig, brand: string | null): BookingLink {
  const row = brand ? c.brands.find((b) => b.name.toLowerCase() === brand.toLowerCase()) : undefined;
  if (row) return ofRow(c, row);
  if (c.brands.length === 0) {
    const url = real(c.booking.url);
    return url ? { url, source: "project", reason: "the project's booking.url" } : { url: null, source: "none", reason: c.booking.url?.trim() === BOOKING_NONE ? "the project offers no booking link (booking.url: none)" : "no booking.url is set" };
  }
  const links = c.brands.map((b) => ofRow(c, b).url);
  const first = links[0] ?? null;
  if (first && links.every((l) => l === first)) return { url: first, source: "project", reason: "the thread's brand is not resolved, and every brand offers this same link" };
  if (links.every((l) => l === null)) return { url: null, source: "none", reason: "no brand of the project has a booking link" };
  return { url: null, source: "unresolved", reason: "the thread's brand is not resolved and the brands' booking links differ: offer none" };
}

/** Every distinct link the project offers somewhere (its default and each brand's own). */
export function bookingLinks(c: BookingConfig): string[] {
  const out = [real(c.booking.url), ...c.brands.map((b) => real(b.booking))].filter((u): u is string => u !== null);
  return [...new Set(out)];
}

const URL_IN_TEXT = /https?:\/\/[^\s<>()"'[\]{}]+/gi;

/** Every URL in a text, trailing punctuation removed. */
export const urlsIn = (text: string): string[] => (text.match(URL_IN_TEXT) ?? []).map((u) => u.replace(/[.,;:!?»”’]+$/u, ""));

const parsed = (u: string): URL | null => {
  try {
    return new URL(u);
  } catch {
    return null;
  }
};

/** A link's identity: host (lower case, no `www.`) and path without the trailing slash; the query and fragment do not count. */
export function linkKey(u: string): string | null {
  const p = parsed(u);
  return p ? `${p.hostname.toLowerCase().replace(/^www\./, "")}${p.pathname.replace(/\/+$/, "")}` : null;
}

const sameLink = (a: string, b: string): boolean => {
  const x = linkKey(a);
  return x !== null && x === linkKey(b);
};

/** A URL on a known scheduler (verdict 8's list). */
export function isSchedulerUrl(u: string): boolean {
  const p = parsed(u);
  if (!p) return false;
  const host = p.hostname.toLowerCase();
  if (SCHEDULER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  if (/^meetings(-[a-z0-9]+)?\.hubspot\.com$/.test(host)) return true;
  return (host === "calendar.google.com" || host === "www.calendar.google.com") && p.pathname.startsWith("/calendar/appointments");
}

/**
 * A URL in the neighbourhood of one of the project's configured links: the same host, and under the link's first path segment
 * (a link at the root claims the whole host). So `https://book.example.test/team/30min` claims `/team/...` on that host, and the
 * site's other pages pass.
 */
function nearConfigured(u: string, links: readonly string[]): boolean {
  const p = parsed(u);
  if (!p) return false;
  return links.some((l) => {
    const q = parsed(l);
    if (!q || q.hostname.toLowerCase().replace(/^www\./, "") !== p.hostname.toLowerCase().replace(/^www\./, "")) return false;
    const seg = q.pathname.split("/").filter(Boolean)[0];
    return !seg || p.pathname.split("/").filter(Boolean)[0] === seg;
  });
}

/** How many times a booking link of this project appears in these texts (one count per occurrence, quotes included). */
export function bookingOffers(texts: readonly (string | null | undefined)[], c: BookingConfig): number {
  const links = bookingLinks(c);
  if (!links.length) return 0;
  let n = 0;
  for (const t of texts) for (const u of urlsIn(t ?? "")) if (links.some((l) => sameLink(u, l))) n++;
  return n;
}

/** What a writer gets for one thread (verdict 3): the link it may put in this message, or null, and why. */
export interface BookingView {
  /** The link this message may carry, literally, or null: offer none. */
  url: string | null;
  /** The thread's link whether or not it may be offered again (the doctor and the refusal name it). */
  link: string | null;
  alreadyOffered: boolean;
  reason: string;
}

/**
 * Verdict 3: once per thread, in code. `offers` is {@link bookingOffers} over the thread. Offered already: no link, except one
 * repeat in a follow-up nudge (`followUp`), never more.
 */
export function bookingFor(c: BookingConfig, brand: string | null, offers: number, o: { followUp?: boolean } = {}): BookingView {
  const l = bookingLinkOf(c, brand);
  if (!l.url) return { url: null, link: null, alreadyOffered: offers > 0, reason: l.reason };
  if (offers === 0) return { url: l.url, link: l.url, alreadyOffered: false, reason: `${l.reason}: offer it once where a call helps (skills/README.md, rule 19)` };
  if (o.followUp && offers === 1) return { url: l.url, link: l.url, alreadyOffered: true, reason: `${l.reason}: offered once in this thread; this follow-up may repeat it, once` };
  return { url: null, link: l.url, alreadyOffered: true, reason: `${l.reason}: already offered in this thread (${offers}x): not again` };
}

/**
 * Verdict 8: the first URL of the agent's new text that is a booking link (a scheduler's, or near one of the project's) and not
 * `allowed`, the link this thread may carry. A scheduler link the client wrote in their own messages passes (their own
 * booking page); the project's own links never pass that way, so a quoted earlier offer is no ticket to repeat it.
 */
export function bookingMismatch(text: string, c: BookingConfig, allowed: string | null, clientTexts: readonly (string | null | undefined)[] = []): string | null {
  const links = bookingLinks(c);
  const theirs = clientTexts.flatMap((t) => urlsIn(t ?? ""));
  for (const u of urlsIn(text)) {
    const ours = links.some((l) => sameLink(u, l)) || nearConfigured(u, links);
    if (!ours && !isSchedulerUrl(u)) continue;
    if (allowed && sameLink(u, allowed)) continue;
    if (!ours && theirs.some((t) => sameLink(t, u))) continue;
    return u;
  }
  return null;
}

/** The refusal's sentence: which link was found and which one this thread may carry. */
export function bookingMismatchMessage(found: string, view: Pick<BookingView, "url" | "link" | "reason">): string {
  const right = view.url ? `the one booking link this message may carry is ${view.url}, word for word` : view.link ? `this thread may carry no booking link now (${view.reason})` : `this thread has no booking link (${view.reason})`;
  return `${found.slice(0, 200)} is a booking link, and ${right}. Remove it${view.url ? " or use that one" : ""} and call again. Nothing was written.`;
}
