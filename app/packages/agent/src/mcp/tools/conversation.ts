import { agentPhone, agentTelegram, type AgentChatLinkedDto } from "@hub/contract/messengers";
import { z } from "zod";
import type { ChatSortAnswer, ChatSortPort } from "../../messenger/chat-sort-port";
import { defineTool } from "../define";
import type { ToolCtx } from "../ports";
import { ToolError } from "../result";
import { attended, chatAccess } from "./messengers";

// P143 (decision 0049 as amended 2026-11-25): three tools over one conversation.
// - `conversation_done`: "no reply needed" on a chat (or on a client's open Mail, Mail's own No reply needed): it leaves Needs you
//   until their next message reopens it, and the reason is one Activity line ("Skipped", the reason in the agent's words). Any
//   session for a linked chat, an unlinked one only attended, an autopilot turn its own chat only; never a send, never a delete.
//   It removes attention, not the follow-up (P142).
// - `client_create` and `chat_link`: the owner's Create and Link of the admin, for the chat in focus, through the server's own path
//   (a loopback door with the agent token, attended only): a lookup by the person's identities first, so no duplicate is made.
//   `client_create` also makes a client with no chat (a name and an email, phone or Telegram username): a Clients card alone.
// A capability, not a duty (L3): the owner's WhatsApp and Telegram are personal too.

const reason = z.string().trim().min(3).max(300);

export const conversationDoneTool = defineTool({
  name: "conversation_done",
  title: "Mark a conversation no reply needed",
  description:
    "Takes one conversation out of Needs you without replying: a chat (`chat`, chat:<id> from focus) or a client's open Mail (`client`). Use it for a short non-question that closes the topic (\"yes\", \"thanks\", \"ok\", an emoji) or when the owner says so; their next message reopens it. `reason` is one line for Activity. Sends nothing, deletes nothing.",
  input: z.object({
    chat: z.number().int().positive().optional().describe("The internal messenger chat id from focus, for example 3 for chat:3."),
    client: z.number().int().positive().optional().describe("A Mail client's id: their open messages get No reply needed."),
    reason: reason.describe("Why no reply is needed, in one line for the owner (for example: they confirmed with \"yes\")."),
  }),
  output: z.object({ project: z.string(), done: z.literal(true), chat: z.number().nullable(), client: z.number().nullable(), name: z.string(), next: z.string() }),
  effect: "pointer",
  refusals: ["not_linked", "not_found", "nothing_to_close", "autopilot_other_chat"],
  handler: async (ctx, { chat, client, reason: why }) => {
    const { repos, project, now } = ctx;
    const slug = project();
    const withRepos = ctx.env.withRepos;
    if (!withRepos) throw new ToolError("unavailable", "This hub MCP server cannot write (no write connection).");
    if ((chat === undefined) === (client === undefined)) throw new ToolError("invalid", "Give chat or client, one of them.");
    const at = now().toISOString();
    const activity = async (w: Parameters<Parameters<typeof withRepos>[0]>[0], name: string, clientId: number | null, detail: Record<string, unknown>) => {
      const runId = await w.runs.start({ project: slug, startedAt: at, finishedAt: at, trigger: "agent", skill: ctx.env.autopilotChat !== undefined ? "autopilot" : "conversation-done", status: "ok" });
      await w.runs.addEvent({ project: slug, runId, at, kind: "decision", tool: "conversation_done", summary: `No reply needed: ${name}`, detail: JSON.stringify({ action: "skipped", reason: why, noReplyNeeded: true, ...detail }), clientId });
    };
    if (chat !== undefined) {
      const row = await chatAccess(repos, ctx.env).target(slug, { chat });
      const clientId = await repos.messengers.clientByIdentifier(slug, row.channel === "whatsapp" ? "whatsapp" : "telegram", row.chatId);
      const c = clientId === null ? null : await repos.clients.get(slug, clientId);
      const name = c?.name || row.title || `chat:${row.id}`;
      const done = await withRepos(async (w) => {
        const r = await w.messengers.markDone(slug, row.id, { by: "agent", reason: why, at });
        if (r) await activity(w, name, clientId, { chat: row.id, channel: row.channel });
        return r;
      });
      if (!done) throw new ToolError("nothing_to_close", `chat:${row.id}: they have not written there, so nothing waits for an answer. Nothing was changed.`);
      return { project: slug, done: true as const, chat: row.id, client: clientId, name, next: "Tell the owner in one line: the chat left Needs you (their next message brings it back). Nothing was sent." };
    }
    if (ctx.env.autopilotChat !== undefined) throw new ToolError("autopilot_other_chat", `This autopilot turn answers chat:${ctx.env.autopilotChat} only: Mail is not its to close.`);
    const id = client as number;
    const conv = await repos.conversations.one(slug, id);
    if (!conv) throw new ToolError("not_found", `No Mail client ${id} in project ${slug}.`);
    const inbound = conv.inboundId;
    if (inbound === null) throw new ToolError("nothing_to_close", `${conv.client.name}: no open message of theirs waits. Nothing was changed.`);
    await withRepos(async (w) => {
      await w.inboundMail.dismiss(slug, inbound, now());
      await activity(w, conv.client.name, id, { inboundId: inbound });
    });
    return { project: slug, done: true as const, chat: null, client: id, name: conv.client.name, next: "Tell the owner in one line: their mail left Needs you as No reply needed; their next message brings it back. Nothing was sent." };
  },
});

const linked = z.object({ project: z.string(), chat: z.number().nullable(), client: z.number().nullable(), name: z.string(), how: z.enum(["created", "linked_existing", "linked", "existing"]), notion: z.string().nullable(), next: z.string() });

function port(ctx: ToolCtx): ChatSortPort {
  if (!attended(ctx.env)) throw new ToolError("unattended", "Only in a session the owner started: a client is created or linked on his word or for a plainly business chat.");
  const p = ctx.env.chatSort;
  if (!p) throw new ToolError("unavailable", "This session cannot reach the Hub server (no agent token).");
  return p;
}
const answer = (slug: string, a: ChatSortAnswer<AgentChatLinkedDto>) => {
  if (!a.ok) throw new ToolError(a.status === 0 ? "unavailable" : a.status === 403 ? "unattended" : a.status === 400 ? "invalid" : a.status === 404 ? "not_found" : /already linked/i.test(a.error) ? "already_linked" : /no notion card|give client/i.test(a.error) ? "not_in_notion" : "refused", a.error);
  const v = a.value;
  return { project: slug, chat: v.chat, client: v.clientId, name: v.name, how: v.how, notion: v.notion, next: nextOf(v) };
};
function nextOf(v: AgentChatLinkedDto): string {
  if (v.chat === null) return v.how === "existing" ? `Tell the owner in one line: ${v.name} is already a client (${v.notion}). Nothing was sent.` : `Tell the owner in one line: ${v.name} is a new Clients card in Notion, with no chat linked. Nothing was sent.`;
  return `Tell the owner in one line: chat:${v.chat} is linked to ${v.name}${v.how === "created" ? " (a new Clients card)" : ""}; he can Unlink it in Messengers. Nothing was sent.`;
}

export const clientCreateTool = defineTool({
  name: "client_create",
  title: "Create a client, from a chat or with none",
  description:
    "Creates a client. With `chat` (chat:<id> from focus, unlinked): a lookup by the email and the chat's number or username first (an existing Hub client or Notion card is linked, never a duplicate), else one new Clients card (name, company, email if given, the chat's number or username), then the link. With no chat: a name and one or more of email, phone, telegram; a lookup by each first (a found client is answered, nothing made), else one new Clients card. Only on the owner's word or for a plainly business person; never a personal chat or contact; in doubt, ask him. Fill only what they said.",
  input: z.object({
    chat: z.number().int().positive().optional().describe("The internal messenger chat id from focus; omit for a client with no chat."),
    name: z.string().trim().min(1).max(200).describe("The person's name as they gave it (or the company's when that is all)."),
    company: z.string().trim().min(1).max(200).optional(),
    email: z.email().max(254).optional().describe("Only an address they wrote."),
    phone: agentPhone.optional().describe("No chat only: a number they gave, with its country code."),
    telegram: agentTelegram.optional().describe("No chat only: a Telegram username they gave."),
  }),
  output: linked,
  effect: "pointer",
  refusals: ["invalid", "unattended", "unavailable", "not_found", "already_linked", "refused"],
  handler: async (ctx, { chat, name, company, email, phone, telegram }) => {
    const slug = ctx.project();
    if (chat === undefined && !email && !phone && !telegram) throw new ToolError("invalid", "Give chat, or at least one of email, phone or telegram: a client is found and reached by one of them.");
    if (chat !== undefined && (phone || telegram)) throw new ToolError("invalid", "With chat, the chat's own number or username fills the card: omit phone and telegram.");
    const p = port(ctx);
    return answer(slug, await p.create(slug, { name, ...(chat !== undefined ? { chat } : {}), ...(company ? { company } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(telegram ? { telegram } : {}) }));
  },
});

export const chatLinkTool = defineTool({
  name: "chat_link",
  title: "Link a chat to a client",
  description:
    "Links an unlinked chat (`chat`, chat:<id> from focus) to a client the Hub knows (`client`, its id from client_show or mail_list) or to a Notion Clients card (`record`, its page id). The chat's number or username fills the card's empty field. Only on the owner's word or for a plainly business chat whose client is clear; in doubt, ask him.",
  input: z.object({
    chat: z.number().int().positive().describe("The internal messenger chat id from focus."),
    client: z.number().int().positive().optional(),
    record: z.string().min(1).max(64).optional().describe("A Notion Clients page id."),
  }),
  output: linked,
  effect: "pointer",
  refusals: ["unattended", "unavailable", "not_found", "already_linked", "not_in_notion", "refused"],
  handler: async (ctx, { chat, client, record }) => {
    const slug = ctx.project();
    if ((client === undefined) === (record === undefined)) throw new ToolError("invalid", "Give client or record, one of them.");
    return answer(slug, await port(ctx).link(slug, { chat, ...(client !== undefined ? { client } : {}), ...(record ? { record } : {}) }));
  },
});
