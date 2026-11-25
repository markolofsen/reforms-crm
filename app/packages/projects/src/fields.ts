// The Settings table of project.md as ONE table (P19): each row names a field, the path it lands on in the resolved
// config and the zod schema that reads its text. The parser, the in-place writer (`checkValue`), the doc table and
// project-setup all read this; adding a field is adding one entry here and one key to `ProjectBase`.
import { z } from "zod";
import { KIND_IDS } from "./kinds";
import { AUTOLINK_MODES, KNOWLEDGE_SCOPES, SEND_MODES, STAMP_MODES, STATUSES } from "./schema";
import { CHAT_INSTRUCTION_MAX } from "@hub/config/chat-rules";
import { FOLLOW_UP_AT, FOLLOW_UP_SCHEDULES } from "@hub/config/follow-ups";
import { BCP47, EMAIL, isIsoDate, isTimezone, normalizeAddress, normalizeId, splitList, UUID } from "./values";

export interface FieldDef {
  /** Dotted path in `ProjectConfig` the parsed value lands on. */
  path: string;
  /** Text of the Value cell in, typed value out. The first issue message is shown to the owner. */
  schema: z.ZodType;
  /** One line for the generated doc table and for project-setup. */
  doc: string;
}

type Msg = (v: string) => string;
const check = (ok: (v: string) => boolean, msg: Msg) => z.string().refine(ok, { error: (iss) => msg(String(iss.input)) });
const oneLine = check((v) => !/[\r\n]/.test(v), () => "expected one line");
const list = z.string().transform(splitList);
const addresses = check((v) => splitList(v).every((a) => EMAIL.test(a)), (v) => `"${splitList(v).find((a) => !EMAIL.test(a))}" is not an email address`).transform((v) => splitList(v).map(normalizeAddress));

/** P62: a list of hub connector names of one kind (`gcal-<label>`, `gdrive-<label>`), as the instance's MCP config names them. */
const connectors = (prefix: string) =>
  check((v) => splitList(v).every((n) => new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]*$`).test(n)), (v) => `"${splitList(v).find((n) => !new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]*$`).test(n))}" is not a ${prefix}-<label> connector name`).transform(splitList);

const posint = check((v) => /^[1-9]\d*$/.test(v), (v) => `expected a positive integer, got "${v}"`).transform(Number);
const doctor = z.string().superRefine((v, ctx) => {
  const m = /^(\d{4}-\d{2}-\d{2}) (pass|fail: .+)$/.exec(v);
  if (!m) return ctx.addIssue({ code: "custom", message: `expected "<date> pass" or "<date> fail: <check>", got "${v}"` });
  if (!isIsoDate(m[1] as string)) ctx.addIssue({ code: "custom", message: `"${m[1]}" is not an ISO date` });
});
const recipients = z.string().superRefine((v, ctx) => {
  if (v === "test" || v === "any") return;
  const bad = splitList(v).find((a) => !EMAIL.test(a));
  if (bad) ctx.addIssue({ code: "custom", message: `expected test, any or a list of addresses; "${bad}" is not an address` });
}).transform((v) => (v === "test" || v === "any" ? v : splitList(v).map(normalizeAddress)));

export const FIELDS: Record<string, FieldDef> = {
  schema: { path: "schema", schema: check((v) => /^\d+$/.test(v), (v) => `expected an integer, got "${v}"`).transform(Number), doc: "Schema version, 1." },
  kind: { path: "kind", schema: check((v) => KIND_IDS.includes(v), (v) => `unknown kind "${v}"; kinds: ${KIND_IDS.join(", ")}`), doc: "Kind of project (kinds.ts): decides modules and required fields. Default generic." },
  name: { path: "name", schema: oneLine, doc: "Display name." },
  status: { path: "status", schema: check((v) => (STATUSES as readonly string[]).includes(v), (v) => `expected one of ${STATUSES.join(", ")}, got "${v}"`), doc: "draft, active, paused or archived." },
  languages: { path: "languages", schema: check((v) => splitList(v).every((l) => BCP47.test(l)), (v) => `"${splitList(v).find((l) => !BCP47.test(l))}" is not a BCP-47 language tag`).transform(splitList), doc: "BCP-47 tags, comma separated." },
  timezone: { path: "timezone", schema: check(isTimezone, (v) => `"${v}" is not an IANA timezone`), doc: "IANA timezone; empty: the host timezone." },
  "mail.accounts": { path: "mail.accounts", schema: list, doc: "Mail.app account names the project reads, comma separated." },
  "mail.addresses": { path: "mail.addresses", schema: addresses, doc: "Addresses routed to the project." },
  "mail.aliases": { path: "mail.aliases", schema: addresses, doc: "More addresses routed to the project (aliases of an account)." },
  "mail.domains": { path: "mail.domains", schema: check((v) => splitList(v).every((d) => /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i.test(d)), (v) => `"${splitList(v).find((d) => !/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i.test(d))}" is not a domain`).transform((v) => splitList(v).map((d) => d.toLowerCase())), doc: "Domains whose mail reaches the project through forwarding or a catch-all (its brands); the agent treats mail to them as this project's." },
  "mail.mailboxes": { path: "mail.mailboxes", schema: list, doc: "Mailboxes read; default INBOX." },
  "mail.sent_mailbox": { path: "mail.sentMailbox", schema: oneLine, doc: "Sent mailbox; default Sent Mail." },
  "mail.sender": { path: "mail.sender", schema: check((v) => EMAIL.test(v), (v) => `"${v}" is not an email address`).transform(normalizeAddress), doc: "From of a reply whose receiving account is not on mail.accounts (P58: replies go from the address the client wrote to, or the receiving account); default the first address." },
  "draft.recipients": { path: "draft.recipients", schema: recipients, doc: "test (the global allow-list), any, or a list of addresses." },
  "send.mode": { path: "send.mode", schema: check((v) => (SEND_MODES as readonly string[]).includes(v), (v) => `expected one of ${SEND_MODES.join(", ")}, got "${v}"`), doc: "draft (default): a person sends with `hub send`; auto: `hub send --due` sends the listed classes after the cancel window." },
  "send.classes": { path: "send.classes", schema: list, doc: "Mail classes of the kind that may be autosent, comma separated; empty: none." },
  "send.daily_cap": { path: "send.dailyCap", schema: posint, doc: "Autosends per rolling 24 hours; empty: the kind's default (5)." },
  "send.delay_minutes": { path: "send.delayMinutes", schema: check((v) => /^[1-9]\d{0,3}$/.test(v) && Number(v) <= 1440, (v) => `expected 1 to 1440 minutes, got "${v}"`).transform(Number), doc: "Cancel window before an autosend, in minutes; empty: the kind's default (10)." },
  tone: { path: "tone", schema: oneLine, doc: "How replies sound, one line." },
  signoff: { path: "signoff", schema: oneLine, doc: "Sign-off line of drafts." },
  "notion.teamspace": { path: "notion.teamspace", schema: oneLine, doc: "Notion teamspace name." },
  "notion.teamspace_id": { path: "notion.teamspaceId", schema: check((v) => UUID.test(v), (v) => `expected a Notion teamspace id (UUID), got "${v}"`).transform(normalizeId), doc: "Id of that teamspace (P82, from notion-get-teams): the session's Notion searches are scoped to it, and a page may be created at its root." },
  "notion.parent_page": { path: "notion.parentPage", schema: check((v) => UUID.test(v), (v) => `expected a Notion page id (UUID), got "${v}"`).transform(normalizeId), doc: "Page the deploy skill creates databases under; wins over the teamspace." },
  "notion.stamp_sends": { path: "notion.stampSends", schema: check((v) => (STAMP_MODES as readonly string[]).includes(v), (v) => `expected on or off, got "${v}"`), doc: "P89: on (default): after a confirmed send the Hub writes Last sent at and Last sent by (the sender's setup name) on the client's Clients page, so the team sees who wrote last; off: nothing is written to Notion." },
  "notion.convert_leads": { path: "notion.convertLeads", schema: check((v) => (STAMP_MODES as readonly string[]).includes(v), (v) => `expected on or off, got "${v}"`), doc: "P97: on (default): at the first confirmed send to a lead the Hub links the lead to its Clients card (or creates one, Relationship Lead, when none has the address) and sets the lead In progress; off: nothing is written on leads at a send." },
  "leads.notice_senders": { path: "leads.noticeSenders", schema: addresses, doc: "P97: addresses whose mail is a site's notification of a lead (a copy of a Leads row): never an Inbox client row, even when the mail filters whitelist them; the lead is shown from Notion Leads instead." },
  "leads.window_days": { path: "leads.windowDays", schema: check((v) => /^[1-9]\d{0,2}$/.test(v) && Number(v) <= 365, (v) => `expected 1 to 365 days, got "${v}"`).transform(Number), doc: "P97: the Inbox lists the Leads rows still New received in the last this many days; default 14. Older ones are one muted count." },
  "notion.token_file": { path: "notion.tokenFile", schema: check((v) => /^[A-Za-z0-9._-]+$/.test(v), () => "expected a file name (no path, no value of a secret)"), doc: "File name in state/secrets/ holding the Notion token." },
  "calendar.name": { path: "calendar.name", schema: oneLine, doc: "Calendar the calendar skill writes holds into." },
  "calendar.id": { path: "calendar.id", schema: oneLine, doc: "Calendar id when the name is not enough; with calendar.connector, the Google calendar id holds go to (default: the connector's primary calendar)." },
  "calendar.timezone": { path: "calendar.timezone", schema: check(isTimezone, (v) => `"${v}" is not an IANA timezone`), doc: "IANA timezone of the calendar." },
  "calendar.connector": { path: "calendar.connector", schema: connectors("gcal"), doc: "P62: Google Calendar connectors (gcal-<label>, from any Google account) this project's sessions may use; holds go to the first, into calendar.id (default: its primary calendar). Needs a kind with the calendar module." },
  "drive.connector": { path: "drive.connector", schema: connectors("gdrive"), doc: "P62: Google Drive connectors (gdrive-<label>, from any Google account) this project's sessions may search, read and link from; never share, write or trash." },
  "drive.folder": { path: "drive.folder", schema: check((v) => splitList(v).every((f) => /^[A-Za-z0-9_-]{10,}$/.test(f)), (v) => `"${splitList(v).find((f) => !/^[A-Za-z0-9_-]{10,}$/.test(f))}" is not a Drive folder id`).transform(splitList), doc: "P62: Drive folder ids a search must stay under (the guard checks a search's query names one); empty: the whole Drive of the connector." },
  "knowledge.source": { path: "knowledge.source", schema: check((v) => v === "files", (v) => `expected files, got "${v}"`), doc: "Always files." },
  "knowledge.scope": { path: "knowledge.scope", schema: check((v) => (KNOWLEDGE_SCOPES as readonly string[]).includes(v), (v) => `expected shared or by-brand, got "${v}"`), doc: "shared (default): one knowledge base for every brand; by-brand: each entry lists its brands and search filters by the thread's brand (needs two or more ## Brands rows)." },
  "messengers.autolink": { path: "messengers.autolink", schema: check((v) => (AUTOLINK_MODES as readonly string[]).includes(v), (v) => `expected on or off, got "${v}"`), doc: "P84: on (default): the Hub links a private Telegram or WhatsApp chat by itself when its phone or username equals the identifier of exactly one client record, imports 30 days and says so in Activity; off: it only suggests." },
  "messengers.language": { path: "messengers.language", schema: check((v) => BCP47.test(v), (v) => `"${v}" is not a BCP-47 language tag`), doc: "Project reply-language override, BCP-47; empty: use the client's language." },
  "messengers.instruction": { path: "messengers.instruction", schema: check((v) => v.length <= CHAT_INSTRUCTION_MAX, (v) => `instruction is ${v.length} characters, the limit is ${CHAT_INSTRUCTION_MAX}`), doc: "One project-wide Messenger instruction; a chat's instruction overrides it. Empty: none." },
  "follow_ups.schedule": { path: "followUps.schedule", schema: check((v) => (FOLLOW_UP_SCHEDULES as readonly string[]).includes(v), (v) => `expected daily or off, got "${v}"`), doc: "P142 (decision 0050): daily (default): the Hub sweeps the project's silent clients once a day and the agent nudges, waits, stops or hands each to you; off: no sweep runs (the dock phrase still works)." },
  "follow_ups.at": { path: "followUps.at", schema: check((v) => FOLLOW_UP_AT.test(v), (v) => `expected HH:MM, got "${v}"`), doc: "P142: the sweep's time of day on this Mac's clock, HH:MM (default 09:00); a Mac asleep then sweeps once when it is next up." },
  "run.quiet_hours": {
    path: "run.quietHours",
    schema: check((v) => v === "off" || /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.test(v), (v) => `expected HH:MM-HH:MM or off, got "${v}"`),
    doc: "No runs between these hours, HH:MM-HH:MM, or off.",
  },
  "run.max_messages": { path: "run.maxMessages", schema: posint, doc: "Messages per run; empty: the global value." },
  "run.max_budget_usd": { path: "run.maxBudgetUsd", schema: check((v) => Number.isFinite(Number(v)) && Number(v) > 0, (v) => `expected a positive number, got "${v}"`).transform(Number), doc: "Budget per run in USD." },
  "setup.completed": { path: "setup.completed", schema: check(isIsoDate, (v) => `"${v}" is not an ISO date (YYYY-MM-DD)`), doc: "Date the setup interview finished." },
  "setup.doctor": { path: "setup.doctor", schema: doctor, doc: "Last doctor result: <date> pass, or <date> fail: <check>." },
};

/** The fields of the send policy (P49 S11): read from `state/projects/<slug>/send-policy.json`, never from project.md. */
export const POLICY_FIELDS = ["draft.recipients", "send.mode", "send.classes", "send.daily_cap", "send.delay_minutes"] as const;
export type PolicyField = (typeof POLICY_FIELDS)[number];
export const isPolicyField = (f: string): f is PolicyField => (POLICY_FIELDS as readonly string[]).includes(f);

/** Returns an error message, or null when `value` is acceptable for `field`. An empty value is always acceptable here. */
export function checkValue(field: string, value: string): string | null {
  const def = FIELDS[field];
  if (!def) return `unknown field "${field}"`;
  if (value === "") return null;
  const r = def.schema.safeParse(value);
  return r.success ? null : (r.error.issues[0]?.message ?? "invalid value");
}

/** The typed value of a field, or undefined for an empty or invalid text. */
export function readField(field: string, value: string): unknown {
  const def = FIELDS[field];
  if (!def || value === "") return undefined;
  const r = def.schema.safeParse(value);
  return r.success ? r.data : undefined;
}

export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur = target;
  for (const s of segs.slice(0, -1)) cur = (cur[s] ??= {}) as Record<string, unknown>;
  cur[segs[segs.length - 1] as string] = value;
}
