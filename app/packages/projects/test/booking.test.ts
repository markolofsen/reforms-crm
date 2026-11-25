import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ownSignoff, signatureFor, signBody, signingNames } from "../src/brands";
import { bookingFor, bookingLinkOf, bookingLinks, bookingMismatch, bookingOffers, isSchedulerUrl, type BookingConfig } from "../src/brands";
import { bookingChecks } from "../src/booking-doctor";
import { checkValue } from "../src/fields";
import { parseProjectMd } from "../src/parse";
import { applyBrandRow, applySetting } from "../src/write";

// P155: the booking link of a thread (verdicts 3, 4), the check at the agent's write (verdict 8), the column and the setting
// (step 2) and the doctor's rows (verdict 11). Made-up URLs only: the core repository is public.

const A = "https://cal.example.test/alpha/30min";
const B = "https://calendly.com/example-beta/intro";
const P = "https://book.example.test/project";

const cfg = (o: Partial<BookingConfig> = {}): BookingConfig => ({ booking: { url: P }, brands: [{ name: "Alpha", booking: A }, { name: "Beta", booking: B }, { name: "Gamma", booking: null }, { name: "Delta", booking: "none" }], ...o });

describe("bookingLinkOf (verdict 4)", () => {
  it("the brand's own link, else the project's, and none for a brand that says none", () => {
    expect(bookingLinkOf(cfg(), "Alpha")).toMatchObject({ url: A, source: "brand" });
    expect(bookingLinkOf(cfg(), "beta").url).toBe(B);
    expect(bookingLinkOf(cfg(), "Gamma")).toMatchObject({ url: P, source: "project" });
    expect(bookingLinkOf(cfg(), "Delta")).toMatchObject({ url: null, source: "none" });
  });

  it("an unresolved brand gets none when the brands' links differ, never the project default", () => {
    expect(bookingLinkOf(cfg(), null)).toMatchObject({ url: null, source: "unresolved" });
    expect(bookingLinkOf(cfg(), "Unknown brand").url).toBeNull();
  });

  it("an unresolved brand gets the one link every brand shares; a project without brands its booking.url", () => {
    expect(bookingLinkOf({ booking: { url: P }, brands: [{ name: "Alpha", booking: null }, { name: "Beta", booking: null }] }, null).url).toBe(P);
    expect(bookingLinkOf({ booking: { url: P }, brands: [] }, null).url).toBe(P);
    expect(bookingLinkOf({ booking: { url: "none" }, brands: [] }, null).url).toBeNull();
    expect(bookingLinkOf({ booking: { url: null }, brands: [] }, null).url).toBeNull();
  });

  it("lists each distinct configured link once", () => {
    expect(bookingLinks(cfg())).toEqual([P, A, B]);
  });
});

describe("bookingFor (verdict 3: once, in code)", () => {
  it("not offered yet: the link; offered: none; a follow-up may repeat it once, never twice", () => {
    expect(bookingFor(cfg(), "Alpha", 0)).toMatchObject({ url: A, alreadyOffered: false });
    expect(bookingFor(cfg(), "Alpha", 1)).toMatchObject({ url: null, link: A, alreadyOffered: true });
    expect(bookingFor(cfg(), "Alpha", 1, { followUp: true })).toMatchObject({ url: A, alreadyOffered: true });
    expect(bookingFor(cfg(), "Alpha", 2, { followUp: true }).url).toBeNull();
  });

  it("counts every configured link in the thread, a query string and a trailing slash included", () => {
    expect(bookingOffers([`pick a time: ${A}?month=2026-12.`, `> ${B}/`, "no link here", null], cfg())).toBe(2);
    expect(bookingOffers(["https://zoom.example.test/j/123"], cfg())).toBe(0);
  });
});

describe("bookingMismatch (verdict 8)", () => {
  it("the thread's own link passes; another brand's link and an unknown scheduler are refused", () => {
    expect(bookingMismatch(`If it is easier to talk it through, pick a time here: ${A}`, cfg(), A)).toBeNull();
    expect(bookingMismatch(`Book here: ${B}`, cfg(), A)).toBe(B);
    expect(bookingMismatch("Book here: https://savvycal.com/example-person/chat", cfg(), A)).toBe("https://savvycal.com/example-person/chat");
    expect(bookingMismatch(`Book here: ${A}`, cfg(), null)).toBe(A);
  });

  it("a Zoom or docs link, and the site's other pages, are untouched", () => {
    expect(bookingMismatch("Join: https://zoom.example.test/j/123 and read https://docs.example.test/start", cfg(), null)).toBeNull();
    expect(bookingMismatch("Prices: https://book.example.test/pricing", cfg({ booking: { url: "https://book.example.test/team/30min" } }), null)).toBeNull();
    expect(bookingMismatch("Another slot: https://book.example.test/team/60min", cfg({ booking: { url: "https://book.example.test/team/30min" } }), null)).toBe("https://book.example.test/team/60min");
  });

  it("a scheduler link the client wrote passes; our own quoted link never does", () => {
    const theirs = "https://calendly.com/example-client/15min";
    expect(bookingMismatch(`Booked your slot via ${theirs}`, cfg(), A, [`You can grab time here: ${theirs}`])).toBeNull();
    expect(bookingMismatch(`Again: ${A}`, cfg(), null, [`> pick a time here: ${A}`])).toBe(A);
  });

  it("knows the scheduler hosts of the verdict, HubSpot's and Google's appointment pages", () => {
    for (const u of ["https://calendly.com/x", "https://app.cal.com/x", "https://calendar.app.google/abc", "https://tidycal.com/x", "https://zcal.co/x", "https://meetings-eu1.hubspot.com/x", "https://calendar.google.com/calendar/appointments/schedules/x"]) expect(isSchedulerUrl(u), u).toBe(true);
    for (const u of ["https://calendar.google.com/calendar/r", "https://example.test/cal.com"]) expect(isSchedulerUrl(u), u).toBe(false);
  });
});

const fx = path.join(__dirname, "fixtures", "brands");
const base = readFileSync(path.join(fx, "two-accounts.md"), "utf8");

describe("the Booking column and booking.url (step 2)", () => {
  it("a table without the column reads Booking as empty; the writer widens the table only when a value needs it", () => {
    const p = parseProjectMd(base, "two-accounts");
    const second = p.config.brands[1];
    if (!second) throw new Error("fixture");
    expect(p.config.brands.every((b) => b.booking === null)).toBe(true);
    const plain = applyBrandRow(base, "two-accounts", { name: second.name, receivesAt: second.receivesAt, signature: ["Team"], by: "owner", date: "2026-11-26" });
    expect(plain).not.toContain("| Booking |");
    const booked = applyBrandRow(base, "two-accounts", { name: second.name, receivesAt: second.receivesAt, signature: second.signature, booking: A, by: "owner", date: "2026-11-26" });
    const again = parseProjectMd(booked, "two-accounts");
    expect(again.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(booked).toContain("| Display name | Booking |");
    expect(again.config.brands[1]?.booking).toBe(A);
    expect(again.config.brands[0]?.booking).toBeNull();
    // A signature edit of a wide table keeps the Booking cell (the commands pass the old value through).
    const kept = applyBrandRow(booked, "two-accounts", { name: second.name, receivesAt: second.receivesAt, signature: ["New line"], booking: again.config.brands[1]?.booking ?? null, by: "owner", date: "2026-11-26" });
    expect(parseProjectMd(kept, "two-accounts").config.brands[1]).toMatchObject({ signature: ["New line"], booking: A });
  });

  it("refuses a Booking that is not an https URL or none", () => {
    const second = parseProjectMd(base, "two-accounts").config.brands[1];
    if (!second) throw new Error("fixture");
    expect(() => applyBrandRow(base, "two-accounts", { name: second.name, receivesAt: second.receivesAt, signature: [], booking: "http://cal.example.test/x", by: "owner", date: "2026-11-26" })).toThrow(/https URL or none/);
  });

  it("booking.url takes an https URL or none, and lands on config.booking.url", () => {
    expect(checkValue("booking.url", P)).toBeNull();
    expect(checkValue("booking.url", "none")).toBeNull();
    expect(checkValue("booking.url", "calendly.com/x")).toMatch(/https URL/);
    const out = applySetting(base, "booking.url", P, "owner", "2026-11-26");
    expect(parseProjectMd(out, "two-accounts").config.booking.url).toBe(P);
  });
});

describe("the doctor's booking rows (verdict 11)", () => {
  it("one row per link: a warning only for a host that does not resolve or a gone page; a 403 is could not check", async () => {
    const rows = await bookingChecks(cfg(), async (u) => (u === A ? { state: "not_found", detail: "404" } : u === B ? { state: "unknown", detail: "answered 403" } : { state: "ok" }));
    expect(rows.map((r) => r.outcome)).toEqual(["pass", "warn", "skipped", "pass"]);
    expect(rows.at(-1)?.detail).toMatch(/none for Delta/);
  });

  it("no link set: one skipped row; no probe: not checked here", async () => {
    expect(await bookingChecks({ booking: { url: null }, brands: [] })).toEqual([expect.objectContaining({ outcome: "skipped" })]);
    expect((await bookingChecks({ booking: { url: P }, brands: [] }))[0]?.detail).toMatch(/not checked here/);
  });
});

describe("the booking sentence before the signature (verdict 5)", () => {
  it("is not taken for the agent's own sign-off, and the hub signs after it", () => {
    const c = { signoff: "", brands: [{ name: "Alpha", receivesAt: [], signature: ["Alpha team", "alpha.example"], displayName: null, booking: A, answered: "2026-11-26", by: "owner" as const }], languages: ["en"] };
    const body = `Thanks for the details.\n\nIf it is easier to talk it through, pick a time here: https://cal.example.test/alpha/30min`;
    expect(ownSignoff(body, [], signingNames(c))).toBeNull();
    const signed = signBody(body, signatureFor(c, { brand: "Alpha", wroteTo: null }));
    expect(signed.endsWith("pick a time here: https://cal.example.test/alpha/30min\n\nAlpha team\nalpha.example")).toBe(true);
  });
});
