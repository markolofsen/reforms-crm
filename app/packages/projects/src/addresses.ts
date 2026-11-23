import type { ProjectConfig } from "./schema";
import { EMAIL, normalizeAddress } from "./values";

/** One Email Routing rule, in the shape the Cloudflare API returns (only what is read). */
export interface RoutingRule {
  enabled?: boolean;
  matchers?: { type: string; field?: string; value?: string }[];
  actions?: { type: string; value?: string[] }[];
}
/** `{ "<zone>": { rules: [...] } }`: what a routing snapshot of several zones looks like. */
export type RoutingSnapshot = Record<string, { rules?: RoutingRule[] }>;

export interface AddressProposal {
  /** Addresses a rule forwards into one of the project's mail accounts or addresses, not yet listed in the project. */
  add: string[];
  /** Addresses already listed (addresses or aliases): nothing to do. */
  known: string[];
  /** Zones whose catch-all forwards to the project: every address there arrives, none is listed (mail routes by account). */
  catchAll: string[];
}

/**
 * Which addresses reach a project through forwarding rules (read-only, pure): a rule counts when it is enabled, matches one literal
 * recipient (`to`), and forwards to an address the project owns (`mail.accounts` or `mail.addresses`). Catch-all rules name no address:
 * they are reported by zone. Nothing here calls an API: the snapshot is a file the owner exported.
 */
export function proposeAddresses(snapshot: RoutingSnapshot, project: { accounts: string[]; addresses: string[]; aliases: string[] }): AddressProposal {
  const mine = new Set([...project.accounts, ...project.addresses].map(normalizeAddress));
  const listed = new Set([...project.addresses, ...project.aliases].map(normalizeAddress));
  const add = new Set<string>(), known = new Set<string>(), catchAll = new Set<string>();
  for (const [zone, z] of Object.entries(snapshot)) {
    for (const r of z.rules ?? []) {
      if (r.enabled === false) continue;
      const reaches = (r.actions ?? []).some((a) => a.type === "forward" && (a.value ?? []).some((v) => mine.has(normalizeAddress(v))));
      if (!reaches) continue;
      const m = r.matchers ?? [];
      if (m.some((x) => x.type === "all")) { catchAll.add(zone); continue; }
      for (const x of m) if (x.type === "literal" && x.field === "to" && x.value) {
        const a = normalizeAddress(x.value);
        (listed.has(a) ? known : add).add(a);
      }
    }
  }
  return { add: [...add].sort(), known: [...known].sort(), catchAll: [...catchAll].sort() };
}

/** The project's own Mail identity, as `resolveBrand` and the table check read it. */
export type OwnMail = Pick<ProjectConfig["mail"], "accounts" | "addresses" | "domains">;

export const accountAddresses = (m: OwnMail): Set<string> => new Set(m.accounts.filter((a) => EMAIL.test(a.trim())).map(normalizeAddress));
export const domainOf = (a: string): string => a.slice(a.lastIndexOf("@") + 1);

/** Whether an address belongs to the project: one of its accounts, addresses or aliases, or on one of its domains. */
export function isOwnAddress(address: string, m: OwnMail): boolean {
  const a = normalizeAddress(address);
  if (!EMAIL.test(a)) return false;
  return accountAddresses(m).has(a) || m.addresses.map(normalizeAddress).includes(a) || m.domains.includes(domainOf(a));
}
