import { z } from "zod";

// The `context` block of a draft record (P28 B1, research 15 section 3.1; `draft_write`'s `record` since P129 A3): what the agent
// says the draft was based on, stored for the card and never judged (P140 K2, owner 2026-11-24: the agent follows the workflow).
// No mail text lives here beyond short owner-approved fields: anchors, personalization, and thread rows of at most 120
// characters of the INCOMING thread (decision 0013). Never our own body.

export const THREAD_STATES = ["filled", "empty", "absent", "unreadable"] as const;

const id = z.union([z.string().trim().min(1).max(200), z.number().int()]).transform((v) => String(v));
const day = z.string().trim().max(40);

/** Strict: a typo in a key must not be silently dropped. */
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
