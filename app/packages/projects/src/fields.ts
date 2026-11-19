// The Settings table of project.md as ONE table (P19): each row names a field, the path it lands on in the resolved
// config and the zod schema that reads its text. The parser, the in-place writer (`checkValue`), the doc table and
// project-setup all read this; adding a field is adding one entry here and one key to `ProjectBase`.
import { z } from "zod";
import { KIND_IDS } from "./kinds";
import { KNOWLEDGE_SCOPES, SEND_MODES, STATUSES } from "./schema";
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
  "mail.sender": { path: "mail.sender", schema: check((v) => EMAIL.test(v), (v) => `"${v}" is not an email address`).transform(normalizeAddress), doc: "From address of drafts; default the first address." },
  "draft.recipients": { path: "draft.recipients", schema: recipients, doc: "test (the global allow-list), any, or a list of addresses." },
  "send.mode": { path: "send.mode", schema: check((v) => (SEND_MODES as readonly string[]).includes(v), (v) => `expected one of ${SEND_MODES.join(", ")}, got "${v}"`), doc: "draft (default): a person sends with `hub send`; auto: `hub send --due` sends the listed classes after the cancel window." },
  "send.classes": { path: "send.classes", schema: list, doc: "Mail classes of the kind that may be autosent, comma separated; empty: none." },
  "send.daily_cap": { path: "send.dailyCap", schema: posint, doc: "Autosends per rolling 24 hours; empty: the kind's default (5)." },
  "send.delay_minutes": { path: "send.delayMinutes", schema: check((v) => /^[1-9]\d{0,3}$/.test(v) && Number(v) <= 1440, (v) => `expected 1 to 1440 minutes, got "${v}"`).transform(Number), doc: "Cancel window before an autosend, in minutes; empty: the kind's default (10)." },
  "context.required": { path: "context.required", schema: check((v) => v === "warn" || v === "block", (v) => `expected warn or block, got "${v}"`), doc: "warn or block: whether `hub record-draft` refuses a draft whose `context` (what was read) is missing or fails the rules; empty: warn until 2026-11-22, block after." },
  tone: { path: "tone", schema: oneLine, doc: "How replies sound, one line." },
  signoff: { path: "signoff", schema: oneLine, doc: "Sign-off line of drafts." },
  "notion.teamspace": { path: "notion.teamspace", schema: oneLine, doc: "Notion teamspace name." },
  "notion.parent_page": { path: "notion.parentPage", schema: check((v) => UUID.test(v), (v) => `expected a Notion page id (UUID), got "${v}"`).transform(normalizeId), doc: "Page the deploy skill creates databases under; wins over the teamspace." },
  "notion.token_file": { path: "notion.tokenFile", schema: check((v) => /^[A-Za-z0-9._-]+$/.test(v), () => "expected a file name (no path, no value of a secret)"), doc: "File name in state/secrets/ holding the Notion token." },
  "calendar.name": { path: "calendar.name", schema: oneLine, doc: "Calendar the calendar skill writes holds into." },
  "calendar.id": { path: "calendar.id", schema: oneLine, doc: "Calendar id when the name is not enough." },
  "calendar.timezone": { path: "calendar.timezone", schema: check(isTimezone, (v) => `"${v}" is not an IANA timezone`), doc: "IANA timezone of the calendar." },
  "knowledge.source": { path: "knowledge.source", schema: check((v) => v === "files", (v) => `expected files, got "${v}"`), doc: "Always files." },
  "knowledge.scope": { path: "knowledge.scope", schema: check((v) => (KNOWLEDGE_SCOPES as readonly string[]).includes(v), (v) => `expected shared or by-brand, got "${v}"`), doc: "shared (default): one knowledge base for every brand; by-brand: each entry lists its brands and search filters by the thread's brand (needs two or more ## Brands rows)." },
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
