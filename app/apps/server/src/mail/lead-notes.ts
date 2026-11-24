import type { LeadNoteDto, LeadSheetDto } from "@hub/contract/inbound";
import type { Repos } from "@hub/db";
import { addressTypo, FREE_MAIL, hostOf } from "@hub/notion";

/** The domain of an address, lower case, else null. */
const domainOf = (email: string | null): string | null => {
  const at = email?.lastIndexOf("@") ?? -1;
  return email && at > 0 ? email.slice(at + 1).trim().toLowerCase() || null : null;
};

/**
 * P138 verdict 4: what the owner should know before replying to a lead, from the Hub's own record only (no Notion read): a
 * mistyped domain in the reply address (a fixed list of typos), a client of the project with this address or an address at the
 * company's domain (the website, else the lead's own non-free-mail domain), and how many forms this address sent. Route files
 * import no @hub/db (P120 verdict 3), so this takes the repos.
 */
export async function leadNotes(repos: Repos, slug: string, row: { email: string | null; accountEmail: string | null }, sheet: LeadSheetDto | null): Promise<LeadNoteDto[]> {
  const notes: LeadNoteDto[] = [];
  const typo = addressTypo(row.email);
  if (typo) notes.push({ kind: "typo", ...typo });
  const emails = [...new Set([row.email, row.accountEmail].filter((e): e is string => !!e))];
  let client: LeadNoteDto | null = null;
  for (const e of emails) {
    const id = await repos.clients.idByEmail(slug, e);
    const c = id === undefined ? null : await repos.clients.get(slug, id);
    if (c) {
      client = { kind: "client", by: "address", clientId: c.id, name: c.name, email: c.email };
      break;
    }
  }
  if (!client) {
    const website = hostOf(sheet?.fields.find((f) => f.key === "website")?.value);
    const domains = [website, ...emails.map(domainOf)].filter((d): d is string => !!d && !FREE_MAIL.has(d) && d !== typo?.domain);
    for (const d of [...new Set(domains)]) {
      const c = (await repos.clients.atDomain(slug, d, 1))[0];
      if (c) {
        client = { kind: "client", by: "company", clientId: c.id, name: c.name, email: c.email };
        break;
      }
    }
  }
  if (client) notes.push(client);
  const forms = row.email ? (await repos.leadRows.ofEmail(slug, row.email)).length : 0;
  if (forms > 1) notes.push({ kind: "repeat", count: forms });
  return notes;
}
