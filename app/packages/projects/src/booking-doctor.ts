// P155 verdict 11: the doctor's booking rows. One row per distinct link: a warning only when its host does not resolve or the page
// answers 404 or 410; a scheduler that refuses scripts (403, a challenge) is "could not check", never a warning. Then one row
// naming the brands that offer no link. The probe touches the network, so the installer injects it (tests pass a fake).
import { bookingLinkOf, bookingLinks, type BookingConfig } from "./brands";

/** What one GET of a booking link said: it answered, its host does not resolve, it is gone, or it could not be told. */
export type BookingProbe = { state: "ok" } | { state: "dns" | "not_found"; detail: string } | { state: "unknown"; detail: string };

export interface BookingCheck {
  name: string;
  outcome: "pass" | "warn" | "skipped";
  detail: string;
}

export async function bookingChecks(c: BookingConfig, probe?: (url: string) => Promise<BookingProbe>): Promise<BookingCheck[]> {
  const links = bookingLinks(c);
  if (links.length === 0) return [{ name: "booking link answers", outcome: "skipped", detail: "no booking link is set (booking.url, the Booking column of ## Brands)" }];
  const rows: BookingCheck[] = [];
  for (const url of links) {
    const name = `booking link answers: ${url}`;
    if (!probe) {
      rows.push({ name, outcome: "skipped", detail: "not checked here (hub doctor <project> checks it)" });
      continue;
    }
    const r = await probe(url).catch((e: unknown) => ({ state: "unknown" as const, detail: e instanceof Error ? e.message : String(e) }));
    rows.push(r.state === "ok" ? { name, outcome: "pass", detail: "the page answers" } : r.state === "unknown" ? { name, outcome: "skipped", detail: `could not check: ${r.detail}` } : { name, outcome: "warn", detail: r.detail });
  }
  if (c.brands.length) {
    const none = c.brands.filter((b) => bookingLinkOf(c, b.name).url === null).map((b) => b.name);
    rows.push({ name: "brands with a booking link", outcome: "pass", detail: none.length ? `${c.brands.length - none.length} of ${c.brands.length}; none for ${none.join(", ")}` : `all ${c.brands.length}` });
  }
  return rows;
}
