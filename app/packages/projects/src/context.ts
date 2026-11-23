import { z } from "zod";

// The `context` evidence block of a draft record (P28 B1, research 15 section 3.1; `draft_write`'s `record` since P129 A3) and the rules V1 to V5 the hub
// applies to it. Pure: the writer (`@hub/agent` records/draft.ts) supplies the earlier records of the batch.
// No mail text lives here beyond short owner-approved fields: anchors, personalization, and thread rows of at most 120
// characters of the INCOMING thread (decision 0013). Never our own body.

export const THREAD_STATES = ["filled", "empty", "absent", "unreadable"] as const;

const id = z.union([z.string().trim().min(1).max(200), z.number().int()]).transform((v) => String(v));
const day = z.string().trim().max(40);

/** Strict: a typo in a key must not be silently dropped. Ranges are NOT enforced here; the rules below judge them (warn or block). */
export const contextSchema = z
  .object({
    batchKey: z.string().trim().min(1).max(100).optional(),
    /** P87: a campaign's short English title, the batch's name in Drafts ("Spring price list"); the owner's words stay the brief. */
    batchTitle: z.string().trim().min(1).max(60).optional(),
    purpose: z.string().trim().max(300).optional(),
    thread: z
      .object({
        firstContact: z.boolean().default(false),
        found: z.number().int().min(0).max(10000),
        read: z.number().int().min(0).max(1000),
        readIds: z.array(id).max(12).default([]),
        inbound: z.number().int().min(0).optional(),
        outbound: z.number().int().min(0).optional(),
        oldest: day.optional(),
        newest: day.optional(),
        cited: z.array(id).max(12).default([]),
        rows: z.array(z.object({ date: day, who: z.string().trim().max(120), subject: z.string().trim().max(200), excerpt: z.string().trim().max(120) }).strict()).max(5).optional(),
      })
      .strict(),
    profile: z
      .object({
        read: z.boolean(),
        notionUrl: z.string().trim().max(1000).optional(),
        state: z.enum(THREAD_STATES),
        editedAt: day.optional(),
        used: z.array(z.string().trim().max(60)).max(20).optional(),
      })
      .strict(),
    facts: z.object({ queries: z.number().int().min(0).max(100), used: z.array(z.string().trim().max(200)).max(30).default([]), missing: z.array(z.string().trim().max(300)).max(30).default([]) }).strict(),
    anchors: z.array(z.string().trim().max(400)).max(10),
    personalization: z.string().trim().max(1000).optional(),
    /** Gaps the draft carries (`profile-empty`, ...): the skill passes them, the hub writes them into the card. */
    gaps: z.array(z.string().trim().max(60)).max(20).optional(),
    template: z.object({ used: z.boolean(), id: z.string().trim().max(100).optional(), role: z.string().trim().max(60).optional() }).strict().optional(),
  })
  .strict();

export type Context = z.infer<typeof contextSchema>;
export type Evidence = "ok" | "weak" | "missing";

export interface Violation {
  code: string;
  text: string;
  /** Amber: shown, never refused (a stale profile, a figure without a knowledge id, a claim above the observation). */
  amber: boolean;
  /** Counts as "no evidence" rather than "weak evidence". */
  missing?: boolean;
}

/** What the hub knows of the other drafts of the same `batchKey` (from the record ledger). */
export interface PriorRecord { email: string; anchors: string[]; personalization?: string }

export interface RecordFacts {
  lastContactAt?: string | null | undefined;
  repliesOwed?: boolean | undefined;
}

const DAY = 86_400_000;
const when = (s: string | undefined) => (s ? Date.parse(s) : NaN);
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Rules V1 to V5. A payload without `context` is one violation, `missing`. */
export function checkContext(ctx: Context | undefined, rec: RecordFacts, prior: readonly PriorRecord[] = []): { violations: Violation[]; evidence: Evidence } {
  if (!ctx) return { violations: [{ code: "context-missing", text: "no context block: what was read is not stated", amber: false, missing: true }], evidence: "missing" };
  const v: Violation[] = [];
  const add = (code: string, text: string, amber = false, missing = false) => v.push({ code, text, amber, ...(missing ? { missing: true } : {}) });
  const t = ctx.thread;

  // V1 and V2: the thread
  if (t.firstContact) {
    if (rec.lastContactAt) add("first-contact-claim", "firstContact is claimed but lastContactAt is set", false, true);
    if (rec.repliesOwed) add("first-contact-claim", "firstContact is claimed but repliesOwed is true", false, true);
    if (t.found > 0) add("first-contact-claim", `firstContact is claimed but the history search found ${t.found} message(s)`, false, true);
  } else {
    if (t.read < 1) add("no-thread-read", "no message of this client was opened", false, true);
    if (t.read < Math.min(t.found, 3)) add("thread-read-short", `opened ${t.read} of the ${Math.min(t.found, 3)} newest messages the rule asks for`);
    if (t.readIds.length !== t.read) add("read-ids-mismatch", `read is ${t.read} but ${t.readIds.length} id(s) are listed`);
    if (t.cited.length === 0 || t.cited.some((c) => !t.readIds.includes(c))) add("cited-invalid", "cited must name at least one opened message and only opened ones");
  }

  // V3: the profile
  if (!ctx.profile.read) add("no-profile-read", "the client's Notion record was not read before the draft", false, true);
  else if (ctx.profile.state !== "filled" && !(ctx.gaps ?? []).includes("profile-empty")) add("profile-gap-unreported", `profile is ${ctx.profile.state} but the gap profile-empty is not carried`);
  const edited = when(ctx.profile.editedAt);
  const newest = when(t.newest);
  if (!Number.isNaN(edited) && !Number.isNaN(newest) && newest - edited > 90 * DAY) add("profile-stale", "the profile was last edited more than 90 days before the newest message", true);

  // V4: anchors and personalization
  if (ctx.anchors.length < 1 || ctx.anchors.length > 3 || ctx.anchors.some((a) => a.length < 12 || a.length > 160)) add("anchors-invalid", "1 to 3 anchors of 12 to 160 characters each");
  const mine = new Set(ctx.anchors.map(norm));
  for (const p of prior) {
    if (p.anchors.some((a) => mine.has(norm(a)))) { add("anchor-duplicate", `an anchor equals one of ${p.email}'s in this batch`); break; }
  }
  const pz = ctx.personalization;
  if (pz === undefined || pz.length < 40 || pz.length > 400) add("personalization-invalid", "personalization: 40 to 400 characters, what is specific to this client");
  else {
    const dup = prior.find((p) => p.personalization && norm(p.personalization) === norm(pz));
    if (dup) add("personalization-duplicate", `personalization equals ${dup.email}'s in this batch`);
  }

  // V5: facts
  if (ctx.facts.queries < 1) add("no-facts-query", "no knowledge_search ran for this client");

  const evidence: Evidence = v.some((x) => x.missing) ? "missing" : v.length ? "weak" : "ok";
  return { violations: v, evidence };
}

/** From this date a missing or failing context is refused when the project sets nothing (decision of 2026-11-15: warn for 7 days, then block). */
export const CONTEXT_BLOCK_FROM = "2026-11-22";

export type ContextMode = "warn" | "block";

/** The project's `context.required` wins; else warn until CONTEXT_BLOCK_FROM, block after. */
export function contextMode(required: ContextMode | null | undefined, now: Date): ContextMode {
  if (required) return required;
  return now.getTime() >= Date.parse(CONTEXT_BLOCK_FROM) ? "block" : "warn";
}
