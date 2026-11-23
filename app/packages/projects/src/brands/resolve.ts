// P60 B2, P126 P1: the one resolver from an inbound's headers to the brand the client wrote to. Pure.
import type { Brand } from "../schema";
import { isOwnAddress, type OwnMail } from "../addresses";
import { EMAIL, normalizeAddress } from "../values";


/** One recipient header of the inbound, its addresses in the order they appear. */
export interface HeaderAddresses {
  name: string;
  addresses: string[];
}

/** The order the brand address is looked for in (doc 16 section 7): the forward's own headers first, `To` and `Cc` last. */
export const BRAND_HEADER_ORDER = ["x-gm-original-to", "x-original-to", "x-forwarded-for", "x-forwarded-to", "delivered-to", "to", "cc"] as const;

/** P85: read only when no recipient header names one of ours: the message is our own, and its From is the address the client knows. */
export const OWN_MESSAGE_HEADER = "from";

const ADDRESS = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[^\s<>,;:"'()[\]]+/g;

/** Every address in a header value (`Name <a@b>, c@d`, or the space-separated `X-Forwarded-For`), normalised. */
export const addressesIn = (value: string): string[] => (value.match(ADDRESS) ?? []).map(normalizeAddress);

/**
 * The recipient headers of a raw header block (as Mail's `all headers` or mail-mcp's `allHeaders` give it): folded lines
 * joined, one entry per header line of a name in {@link BRAND_HEADER_ORDER}, in the order of the block.
 */
export function headersFromText(raw: string): HeaderAddresses[] {
  const out: HeaderAddresses[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ").split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if ((BRAND_HEADER_ORDER as readonly string[]).includes(name) || name === OWN_MESSAGE_HEADER) out.push({ name, addresses: addressesIn(line.slice(i + 1)) });
  }
  return out;
}

export interface BrandResolution {
  /** The project's address the client wrote to, or null when no header names one. */
  wroteTo: string | null;
  /** The brand row it belongs to (its exact name), or null: never a default brand. */
  brand: string | null;
  via: "address" | "domain" | "none";
  reason: string;
}

/**
 * Which brand an inbound belongs to (P60 section 4.2). Step 1, `wroteTo`: walk the headers in {@link BRAND_HEADER_ORDER}
 * (each name's lines in order, each line's addresses in order); the first address that is the project's own and NOT one of
 * its account addresses wins; only if none, the first account address (a forward names the account in `Delivered-To`, so
 * reading it first would make every forwarded mail the account's). Step 2, `brand`: the row listing `wroteTo` exactly,
 * else the row listing its domain, else null with the reason. No recipient header names one of ours, but the From is ours
 * (our own sent message, P85): that From. The From of a reply is not decided here (P58).
 */
export function resolveBrand(headers: readonly HeaderAddresses[], c: { mail: OwnMail; brands: readonly Brand[] }): BrandResolution {
  const ordered: string[] = [];
  for (const name of BRAND_HEADER_ORDER) for (const h of headers) if (h.name.toLowerCase() === name) ordered.push(...h.addresses.map(normalizeAddress));
  const accounts = accountAddresses(c.mail);
  const own = ordered.filter((a) => isOwnAddress(a, c.mail));
  // P85: our own message (a new message on the owner's initiative answers our sent copy) names the client in its
  // recipients and us in From; the address the client knows is that From.
  const ownFrom = own.length ? null : (headers.filter((h) => h.name.toLowerCase() === OWN_MESSAGE_HEADER).flatMap((h) => h.addresses.map(normalizeAddress)).find((a) => isOwnAddress(a, c.mail)) ?? null);
  const wroteTo = own.find((a) => !accounts.has(a)) ?? own.find((a) => accounts.has(a)) ?? ownFrom;
  if (!wroteTo) return { wroteTo: null, brand: null, via: "none", reason: ordered.length ? `no recipient header names an address of this project (${[...new Set(ordered)].slice(0, 3).join(", ")})` : "the message has no recipient headers" };
  if (c.brands.length === 0) return { wroteTo, brand: null, via: "none", reason: "the project has no ## Brands table" };
  const exact = c.brands.find((b) => b.receivesAt.includes(wroteTo));
  if (exact) return { wroteTo, brand: exact.name, via: "address", reason: `${wroteTo} is listed by brand ${exact.name}` };
  const byDomain = c.brands.find((b) => b.receivesAt.includes(domainOf(wroteTo)));
  if (byDomain) return { wroteTo, brand: byDomain.name, via: "domain", reason: `${wroteTo} is on ${domainOf(wroteTo)}, a domain of brand ${byDomain.name}` };
  return { wroteTo, brand: null, via: "none", reason: `${wroteTo} is in no brand row` };
}


/** A deterministic resolution used when the owner explicitly chooses one brand in a shared mailbox. */
export function brandResolutionFor(brands: readonly Brand[], name: string, wroteTo: string | null = null): BrandResolution | null {
  const row = brands.find((brand) => brand.name.toLowerCase() === name.trim().toLowerCase());
  if (!row) return null;
  const address = wroteTo ?? row.receivesAt.find((value) => EMAIL.test(value)) ?? null;
  return { brand: row.name, wroteTo: address, via: address ? "address" : "none", reason: `brand ${row.name} was selected for this draft` };
}
