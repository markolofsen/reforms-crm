import { z } from "zod";
import { DRAFT_STATUSES, EVIDENCE_LEVELS, EVIDENCE_SOURCES, MARKS, NOTION_KINDS } from "@hub/config";
import { displayNameFor } from "@hub/projects/brands";
import { fromFor, isNewThreadDraft } from "../../mail";
import { defineTool } from "../define";
import { configOf, json } from "../ports";
import { cut } from "../result";

// One draft of the bound project (P51), with where its message and Mail versions are (P53, P65) and who the client sees it from (P58).

const mailMessage = z.object({ account: z.string(), mailbox_path: z.array(z.string()), message_id: z.number() });
const stamp = z.object({ at: z.string(), by: z.string() });

export const draftShowOutput = z.object({
  id: z.number(),
  project: z.string(),
  status: z.enum(DRAFT_STATUSES),
  subject: z.string(),
  to: z.string(),
  cc: z.string().nullable(),
  mailRef: z.string().nullable(),
  excerpt: z.string(),
  reason: z.string().nullable(),
  checked: z.boolean(),
  injectionSuspected: z.boolean(),
  client: z.object({ id: z.number(), name: z.string(), email: z.string(), marks: z.array(z.enum(MARKS)), repliesOwed: z.boolean(), lastContactAt: z.string().nullable() }).nullable(),
  evidence: z.object({ level: z.enum(EVIDENCE_LEVELS), source: z.enum(EVIDENCE_SOURCES).nullable(), findings: z.array(z.unknown()), context: z.record(z.string(), z.unknown()) }).nullable(),
  notion: z.object({ kind: z.enum(NOTION_KINDS).nullable(), url: z.string() }).nullable(),
  followUp: z.object({ enrollmentId: z.number(), step: z.number().nullable() }).nullable(),
  activity: z.array(z.object({ at: z.string(), kind: z.string(), summary: z.string() })),
  body: z.string().describe("Where the text is: in Mail, never here."),
  mail: z.array(z.object({ account: z.string(), mail_id: z.number(), message_id: z.string(), written_at: z.string() })).describe("The Mail versions the hub wrote for it, newest first."),
  inbound: mailMessage.nullable().describe("The client's message this draft answers, where mail-mcp opens it."),
  clientWroteTo: z.string().nullable(),
  brand: z.string().nullable(),
  brandDisplayName: z.string().nullable(),
  repliedElsewhere: stamp.extend({ messageId: z.string() }).nullable(),
  teamSent: stamp.nullable(),
  fromSeenByClient: z.string().nullable(),
  fromReason: z.string().nullable(),
  revise: z.object({ note: z.string().optional(), draft_write: z.object({ draft: z.number(), content: z.string() }).optional(), then: z.string().optional() }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const draftShowTool = defineTool({
  name: "draft_show",
  title: "One draft of this project",
  description:
    "One hub draft: status, recipients, mailRef (the Message-ID it answers), excerpt, reason, marks, evidence, context, Notion link, follow-up step, its Activity, `inbound` (where mail-mcp opens the client's message), `clientWroteTo`, `fromSeenByClient` (exactly the From the client sees; no hidden sender) and `fromReason`, `repliedElsewhere` and `teamSent` (someone else answered or wrote), `mail` (the Mail versions the hub recorded) and `revise` (the draft_write call that revises it). Not the body: it lives in Mail.",
  input: z.object({ draft: z.number().int().positive().describe("The draft id, as the focus or the admin shows it (the same name draft_write takes).") }),
  output: draftShowOutput,
  effect: "read",
  refusals: ["not_found"],
  handler: async ({ repos, env, ownDraft }, { draft }) => {
    const { slug, d } = await ownDraft(draft);
    const c = await repos.clients.card(slug, d.clientId);
    // The message this draft answers, where mail-mcp can open it (P53): no hunting with find_messages. Null when not found.
    const pm = env.projectMail?.(slug);
    const inbound = d.mailRef && env.drafts && pm ? await env.drafts.findInbound(pm.accounts, d.mailRef).catch(() => null) : null;
    // P58: who the client sees the reply from, by the rule the writer applies (the receiving account and what it can send as).
    const cfg = pm?.identity ? configOf(pm) : null;
    const rf = inbound && env.drafts && pm ? await fromFor(env.drafts, inbound, d.wroteTo ?? null, pm, cfg ? displayNameFor(cfg, d.brand) : null).catch(() => null) : null;
    const versions = await repos.mailVersions.ofDraft(d.id);
    const events = (await repos.runs.eventsForClient(slug, d.clientId, 100)).filter((e) => json<{ draftId?: number }>(e.detail, {}).draftId === d.id).slice(0, 20);
    const team = await repos.drafts.teamNotice(d.id);
    const finished = d.status === "sent" || d.status === "done" || d.status === "skipped";
    return {
      id: d.id,
      project: slug,
      status: d.status,
      subject: cut(d.subject, 300),
      to: d.toAddr,
      cc: d.ccAddr,
      mailRef: d.mailRef,
      excerpt: cut(d.body, 600),
      reason: d.reason,
      checked: d.checked,
      injectionSuspected: d.injectionSuspected,
      client: c ? { id: c.id, name: cut(c.name), email: c.email, marks: c.marks, repliesOwed: c.repliesOwed, lastContactAt: c.lastContactAt } : null,
      evidence: d.evidence ? { level: d.evidence, source: d.evidenceSource, findings: json<unknown[]>(d.evidenceFindings, []), context: json<Record<string, unknown>>(d.context, {}) } : null,
      notion: d.notionUrl ? { kind: d.notionKind, url: d.notionUrl } : null,
      followUp: d.enrollmentId == null ? null : { enrollmentId: d.enrollmentId, step: d.sequenceStep },
      activity: events.map((e) => ({ at: e.at, kind: e.kind, summary: cut(e.summary, 200) })),
      body: `In Mail, not here: the draft to ${d.toAddr} with subject "${cut(d.subject, 200)}"${d.mailRef ? ` answering Message-ID ${d.mailRef}` : ""}.`,
      // The Mail versions the hub wrote for it (P65), newest first: how its text is found in Drafts without any line in it.
      mail: versions.filter((x) => !x.trashedAt).map((x) => ({ account: x.account, mail_id: x.mailId, message_id: x.messageId, written_at: x.writtenAt })),
      inbound: inbound ? { account: inbound.account, mailbox_path: inbound.mailboxPath, message_id: inbound.messageId } : null,
      clientWroteTo: d.wroteTo ?? null,
      brand: d.brand ?? null,
      brandDisplayName: cfg ? displayNameFor(cfg, d.brand) : null,
      // P90: someone else (a teammate in a shared mailbox, or the owner elsewhere) already answered this thread, or wrote to the client per Notion.
      repliedElsewhere: team.repliedElsewhere,
      teamSent: team.teamSent,
      fromSeenByClient: rf?.from ?? null,
      fromReason: rf?.fromReason ?? null,
      revise: finished
        ? { note: `Draft ${d.id} is ${d.status}: it is not revised. A new message on the owner's words: draft_write kind reply to the newest message of the thread, with owner_request and its record.` }
        : d.mailRef || isNewThreadDraft(d)
          ? { draft_write: { kind: "revise", draft: d.id, content: d.mailRef ? "<the new reply>" : "<the new message>" }, then: "nothing: the revision records itself" }
          : { note: "No mailRef: this draft answers no Mail message, so draft_write cannot revise it." },
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  },
});
