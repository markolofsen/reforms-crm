import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { displayNameFor } from "@hub/projects/brand";
import { fromFor, isNewThreadDraft } from "../../mail";
import { configOf, json, type ToolCtx } from "../ports";
import { cut, DATA, READ_ONLY, run } from "../result";

// One draft of the bound project (P51), with where its message and Mail versions are (P53, P65) and who the client sees it from (P58).

export function registerDraftShow(server: McpServer, { repos, env, ownDraft }: ToolCtx): void {
  server.registerTool(
    "draft_show",
    {
      title: "One draft of this project",
      description: `Status, recipients, the Mail key (mailRef: the Message-ID of the client's message this draft answers), the short excerpt, reason, marks, evidence, the recorded context, the Notion link, the follow-up step, the draft's Activity, \`inbound\` (account, mailbox_path, message_id of the client's message, for mail-mcp get_message_content), \`clientWroteTo\` (the project's address the client wrote to), \`fromSeenByClient\` (the From the hub writes this draft with, by its rule: the client sees exactly that, there is no hidden sender; the owner may still change it in Mail, and the admin card reads Mail's own) and \`fromReason\` (why it is not clientWroteTo, else null), \`repliedElsewhere\` (someone else, a teammate in a shared mailbox or the owner from another device, already answered this thread: who and when; the draft may be out of date: never write a second reply on your own, say so and revise only on the owner's word) and \`teamSent\` (another person wrote to this client per Notion's Last sent by). Not the body: it lives in Mail (\`mail\` names the Mail draft(s) the hub recorded for it: account and Message-ID; read the text with mail-mcp list_drafts / get_message_content). To revise it: \`draft_write\` with \`draft\` = this id (nothing else to look up); the revision records itself. A \`sent\` draft is not revised (\`already_sent\`). Never send. ${DATA}`,
      inputSchema: z.object({ draft: z.number().int().positive().describe("The draft id, as the focus or the admin shows it (the same name draft_write takes).") }),
      annotations: READ_ONLY,
    },
    ({ draft }) =>
      run(async () => {
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
          revise: d.status === "sent" || d.status === "done" || d.status === "skipped" ? { note: `Draft ${d.id} is ${d.status}: it is not revised. A new message on the owner's words: draft_write as a new reply to the newest message of the thread with owner_request, then record-draft with ownerRequest.` } : d.mailRef || isNewThreadDraft(d) ? { draft_write: { draft: d.id, content: d.mailRef ? "<the new reply>" : "<the new message>" }, then: "nothing: the revision records itself" } : { note: "No mailRef: this draft answers no Mail message, so draft_write cannot revise it." },
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        };
      }),
  );
}
