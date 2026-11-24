import { newThreadKey } from "@hub/config";
import { displayNameFor } from "@hub/projects/brands";
import { normalizeAddress } from "@hub/projects/parse";
import { writeLogOf } from "../mail";
import type { NotionClientCheck } from "../mcp/ports";
import { ToolError } from "../mcp/result";
import { landingWrite, pendingVersion } from "./guards";
import { writeFirstMailDraft } from "./write";
import type { DraftScope, Pending, Written } from "./sign";

export interface NewThreadArgs {
  to: string;
  subject: string | undefined;
  content: string;
  owner_request: string | undefined;
  account: string | undefined;
  from: string | undefined;
  brand: string | undefined;
}

/** P85b: a brand-new thread to a client the project never wrote to and who never wrote, on the owner's words only. */
export async function writeNewThread(s: DraftScope, a: NewThreadArgs): Promise<Written | Pending> {
  const { ctx, slug, writer, mail, cfg } = s;
  if (!a.owner_request) throw new ToolError("owner_request_needed", "A new thread is written only on the owner's words: pass owner_request = his own words from this session, verbatim. Nothing was written.");
  if (!a.subject) throw new ToolError("invalid", "A new thread needs a subject.");
  const brandName = a.brand;
  if (brandName !== undefined && !cfg.brands.some((b) => b.name.toLowerCase() === brandName.toLowerCase())) throw new ToolError("invalid", `"${brandName}" is not a row of project ${slug}'s ## Brands (${cfg.brands.map((b) => b.name).join(", ") || "none"}). Nothing was written.`);
  const email = normalizeAddress(a.to);
  if (s.isOurs(email)) throw new ToolError("not_this_project", `${email} is one of this project's own addresses: a new message goes to the client, never to us. Nothing was written.`);
  const clientId = await ctx.repos.clients.findByIdentity(slug, "email", email);
  if (clientId !== undefined) {
    const card = await ctx.repos.clients.card(slug, clientId);
    if (card?.marks.includes("do_not_contact")) throw new ToolError("do_not_contact", `${email} is marked do not contact in this project: no message is written. Nothing was written.`);
    const rows = await ctx.repos.drafts.ofClient(slug, clientId);
    const open = rows.find((x) => x.status === "ready" || x.status === "hold");
    if (open) throw new ToolError("already_drafted", `Draft ${open.id} of this client waits for review: revise it with draft=${open.id}. Nothing was written.`);
    if (rows[0]) throw new ToolError("has_thread", `The hub already wrote to ${email} (draft ${rows[0].id}, ${rows[0].status}): a thread exists. Reply to its newest message (ours in Sent, or theirs) with owner_request instead of a new thread. Nothing was written.`);
  } else if (!(ctx.env.testRecipients?.(slug) ?? []).some((x) => normalizeAddress(x) === email)) {
    // P87: a new thread goes only to a client: a recorded one passes above, any other address must be in the project's Notion Clients.
    const check: NotionClientCheck = ctx.env.clientInNotion ? await ctx.env.clientInNotion(slug, email).catch((e: unknown) => ({ state: "unavailable" as const, reason: `the Notion read failed (${e instanceof Error ? e.name : "error"})` })) : { state: "unavailable", reason: "this hub MCP server has no Notion reader" };
    if (check.state === "unavailable") throw new ToolError("notion_unavailable", `${email} is not a recorded client, and the project's Notion Clients could not be checked: ${check.reason}. Nothing was written.`);
    if (check.state === "do_not_contact") throw new ToolError("do_not_contact", `${email} is marked Do not contact in the project's Notion Clients: no message is written. Nothing was written.`);
    if (check.state === "not_client") throw new ToolError("not_a_client", `${email} is not a client of project ${slug}: no row of its Notion Clients or Leads (Status not Spam) has this address, and the Hub has no record of it. A new thread goes only to a client or a lead. Nothing was written.`);
    // P97 S3 (decision 0044 point 2): a Leads row of the project is a known person for a new thread.
  }
  const mailRef = newThreadKey(email);
  const pending = await pendingVersion(s, mailRef);
  if (pending) return { pending: { mailId: pending.mailId, messageId: pending.messageId, account: pending.account, brand: pending.brand, wroteTo: pending.wroteTo }, mailRef };
  const landing = await landingWrite(s, mailRef);
  if (landing) throw new ToolError("mail_slow", `The hub's new message to ${email} at ${landing.startedAt} has not shown in Mail yet (Mail is slow). Do not write it again now: tell the owner in one line. Nothing was written.`);
  const account = a.account;
  const acc = account === undefined ? mail.accounts[0] : mail.accounts.find((x) => x.trim().toLowerCase() === account.trim().toLowerCase());
  if (!acc) throw new ToolError("not_this_project", `Account "${account ?? ""}" is not one of project ${slug}'s Mail accounts (${mail.accounts.join(", ") || "none listed in project.md"}).`);
  if (a.from !== undefined && !s.isOurs(a.from)) throw new ToolError("not_this_project", `${a.from} is not one of project ${slug}'s own addresses: a new message goes from the project's sender or a brand address.`);
  const sender = a.from ?? mail.sender ?? null;
  const { body, ...how } = s.signFrom(sender ?? acc, a.content, brandName ?? null);
  const r = await writeFirstMailDraft({
    writer,
    mail,
    displayName: displayNameFor(cfg, how.brand),
    target: { kind: "new", to: email, subject: a.subject, account: acc, from: sender },
    body,
    signed: how,
    ...(ctx.env.withRepos ? { log: writeLogOf(ctx.env.withRepos, slug, null, mailRef) } : {}),
  });
  return { r, mailRef, versionRows: [] };
}
