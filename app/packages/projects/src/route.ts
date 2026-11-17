// How a message picks its project (doc 16 section 7). Pure: the gate passes what it read from the message.
import { normalizeAddress, type ProjectConfig, type ProjectStatus } from "./parse";

export interface RegistryProject {
  slug: string;
  status: ProjectStatus;
  /** Mail.app account names, lower-cased. */
  accounts: string[];
  /** Normalised addresses (lower-case, no +tag). */
  addresses: string[];
}

export type Routing =
  | { outcome: "project"; project: string }
  | { outcome: "unrouted" }
  | { outcome: "ambiguous"; candidates: string[] }
  /** The message belongs to a project that is not `active`: no run, and no question either. */
  | { outcome: "inactive"; project: string; status: ProjectStatus };

export const registryEntry = (c: ProjectConfig): RegistryProject => ({
  slug: c.slug,
  status: c.status,
  accounts: c.mail.accounts.map((a) => a.trim().toLowerCase()),
  addresses: c.mail.addresses.map(normalizeAddress),
});

/**
 * 1. candidates are `active` projects; 2. a recipient match (To, Cc, Delivered-To, X-Original-To) wins over an
 * account match, because one Mail account can hold several projects through aliases; 3. exactly one candidate routes,
 * none is `unrouted`, several are `ambiguous`. A project that matches but is not active yields `inactive` only when no
 * active project matched. There is never a default project.
 */
export function resolveProject(msg: { account: string; recipients: string[] }, registry: RegistryProject[]): Routing {
  const recipients = new Set(msg.recipients.map(normalizeAddress).filter(Boolean));
  const account = msg.account.trim().toLowerCase();
  const byRecipient = registry.filter((p) => p.addresses.some((a) => recipients.has(a)));
  const byAccount = registry.filter((p) => account !== "" && p.accounts.includes(account));

  for (const matches of [byRecipient, byAccount]) {
    if (matches.length === 0) continue;
    const active = matches.filter((p) => p.status === "active");
    if (active.length === 1) return { outcome: "project", project: (active[0] as RegistryProject).slug };
    if (active.length > 1) return { outcome: "ambiguous", candidates: active.map((p) => p.slug).sort() };
    const first = matches[0] as RegistryProject;
    return { outcome: "inactive", project: first.slug, status: first.status };
  }
  return { outcome: "unrouted" };
}
