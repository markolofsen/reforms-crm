// P145 K5 (decision 0053 point 5, verdict 12): a site's lead notice names its project. django_notion puts the key in an
// `X-Project-Key` header and, because a forward may drop a header, in a fixed first body line `Project key: <key>`. Only a sender
// on the project's `leads.notice_senders` is believed: a header or a line a stranger can type never chooses a brand
// (`resolveBrand` stays recipient-only for people's mail). The key names the brand in the "lead notice" ops line; the lead's brand
// of record stays the Leads page's `Brand`, read by the Leads reader.
import { brandForKey, projectKey } from "@hub/projects/brands";
import type { ProjectConfig } from "@hub/projects/model";
import { errFields, ops } from "@hub/log/ops";

/** A machine sender (no-reply, notifications, robot, ...): never a person writing. */
export const MACHINE = /^(no-?reply|do-?not-?reply|noreply-[\w.-]+|[\w.-]*-noreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|dmarc[\w.-]*|robot|daemon)(\+[^@]*)?@/i;

/**
 * P97 verdict 1 (decision 0044 point 1): a site's notification of a lead is never a person writing. A sender on the project's
 * `leads.notice_senders`, or a machine address the mail filters whitelist (the owner keeps `robot@…` visible in Mail, which
 * made it an Inbox client row), is a lead notice. A machine the filters do not whitelist stays `machine`, as before.
 */
export function isLeadNotice(email: string, noticeSenders: readonly string[], whitelisted: boolean): boolean {
  const e = email.trim().toLowerCase();
  return noticeSenders.includes(e) || (whitelisted && MACHINE.test(e));
}

/** A stored Inbox row whose sender is a lead notice by its address alone (the re-judge of rows stored before P97: a stored machine sender was whitelisted). */
export const storedRowIsNotice = (email: string, noticeSenders: readonly string[]): boolean => isLeadNotice(email, noticeSenders, true);

/** The fixed line of the notice body, as django_notion writes it (searched in the first lines only). */
const KEY_LINE = /^\s*Project key:\s*([A-Za-z0-9][A-Za-z0-9._-]{0,79})\s*$/;
const HEAD_LINES = 12;

/** The key of the `Project key:` line among the first lines of a notice's text, or null. Pure. */
export function noticeKeyOfText(text: string): string | null {
  for (const line of text.split(/\r?\n/).slice(0, HEAD_LINES)) {
    const m = KEY_LINE.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

export interface NoticeKey {
  key: string | null;
  /** The `## Brands` row with the same project key, or null (a project with no brand row, or no key). */
  brand: string | null;
  via: "header" | "body" | "none";
}

/** The project a lead notice names: the header first, the body line only when the header is empty. A sender off the list: none. */
export async function noticeKeyOf(m: { email: string; projectKey: string | null }, config: Pick<ProjectConfig, "brands"> & { leads: { noticeSenders: readonly string[] } }, readText: () => Promise<string | null>): Promise<NoticeKey> {
  if (!config.leads.noticeSenders.includes(m.email.trim().toLowerCase())) return { key: null, brand: null, via: "none" };
  const header = projectKey(m.projectKey) ? m.projectKey : null;
  const key = header ?? noticeKeyOfText((await readText()) ?? "");
  if (!key) return { key: null, brand: null, via: "none" };
  return { key, brand: brandForKey(config.brands, key)?.name ?? null, via: header ? "header" : "body" };
}

/** One ops line per new lead notice, with the brand it names. Never throws: a failed text read is a line without a key. */
export async function logLeadNotice(slug: string, m: { email: string; projectKey: string | null }, config: Parameters<typeof noticeKeyOf>[1], readText: () => Promise<string | null>): Promise<NoticeKey> {
  try {
    const k = await noticeKeyOf(m, config, readText);
    ops("mail").info("lead notice", { project: slug, key: k.key, brand: k.brand, via: k.via });
    return k;
  } catch (e) {
    ops("mail").warn("reading a lead notice's project key failed", { project: slug, ...errFields(e) });
    return { key: null, brand: null, via: "none" };
  }
}
