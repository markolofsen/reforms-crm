// P58, P126 P1: who a reply goes from, and the brand's display name on it.
import type { Brand, ProjectConfig } from "../schema";
import { accountAddresses } from "../addresses";
import { EMAIL, normalizeAddress } from "../values";
import { normalizedDisplayName } from "./table";


export interface ReplyFrom {
  /** The From the writer sets: what the client will see. */
  from: string | null;
  /** The project's address the client wrote to (`resolveBrand` step 1), or null. */
  clientWroteTo: string | null;
  /** Why the reply fell back to `mail.sender` (a fault: the receiving account is not usable); null otherwise. */
  fromReason: string | null;
  /** `wrote-to`: the address they wrote to (the account can send as it); `account`: the receiving account; `sender`: `mail.sender`. */
  via: "wrote-to" | "account" | "sender";
}

/** The configured visible name for a resolved brand; absent means Mail keeps its account name. */
export function displayNameFor(c: { brands: readonly Brand[] }, brand: string | null | undefined): string | null {
  if (!brand) return null;
  return normalizedDisplayName(c.brands.find((b) => b.name.toLowerCase() === brand.toLowerCase())?.displayName);
}

/** Formats the visible From without changing or authorizing the technical sender address. */
export function visibleFrom(address: string | null, displayName?: string | null): string | null {
  if (!address) return null;
  const name = normalizedDisplayName(displayName);
  return name ? `${name} <${normalizeAddress(address)}>` : address;
}

/**
 * The From of a reply (P58). A reply goes from the address the client wrote to when the Mail account that received it
 * can send as that address (it is among the account's own addresses in Mail: `email addresses of acc`, the one truth for
 * "can send as"); else from the receiving account itself. That second case is the design, not a fault (owner,
 * 2026-11-20): a brand address such as info@carapis.com is a forward into hello@reforms.ai, which answers it, so there is
 * no `fromReason`; the card and the agent name the address they wrote to as context. Only when the receiving account is
 * not on `mail.accounts` (or has no address) does the reply fall back to `mail.sender`, with the reason. So saas answers
 * mail to info@carapis.com from hello@reforms.ai; realty answers mail to dan@ from dan@ and mail to info@ (or its
 * aliases) from info@. Pure.
 */
export function replyFrom(q: { account: string; accountAddresses: readonly string[]; clientWroteTo: string | null; displayName?: string | null }, c: { mail: Pick<ProjectConfig["mail"], "accounts" | "sender"> }): ReplyFrom {
  const wrote = q.clientWroteTo ? normalizeAddress(q.clientWroteTo) : null;
  const acct = q.account.trim();
  const onList = c.mail.accounts.some((a) => a.trim().toLowerCase() === acct.toLowerCase());
  const own = [...new Set([...(EMAIL.test(acct) ? [normalizeAddress(acct)] : []), ...q.accountAddresses.map(normalizeAddress).filter((a) => EMAIL.test(a))])];
  const sender = c.mail.sender ? normalizeAddress(c.mail.sender) : null;
  if (onList && wrote && own.includes(wrote)) return { from: visibleFrom(wrote, q.displayName), clientWroteTo: wrote, fromReason: null, via: "wrote-to" };
  const receiving = own[0] ?? null;
  if (onList && receiving) return { from: visibleFrom(receiving, q.displayName), clientWroteTo: wrote, fromReason: null, via: "account" };
  const why = onList ? `the receiving account ${acct} shows no address in Mail` : `the receiving account ${acct} is not on mail.accounts`;
  return { from: visibleFrom(sender, q.displayName), clientWroteTo: wrote, fromReason: `${why}: from mail.sender ${sender ?? "(none set)"}`, via: "sender" };
}
