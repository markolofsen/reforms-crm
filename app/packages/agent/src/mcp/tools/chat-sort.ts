import { z } from "zod";
import { defineTool, unavailableAnswer } from "../define";
import { ToolError } from "../result";

// P128 X5 ("sort the chats", phrase of skill `sort-chats`): the agent reads the unlinked chats the Hub saw and proposes
// "Hide: not a client" for those that are not, each with its reason. The owner confirms the whole list in one dialog on
// Messengers ▸ Not linked; each hide keeps its Undo. Proposing hides, links and sends nothing (decision 0025: a proposal confirmed
// by his click).

const channel = z.enum(["telegram_user", "whatsapp"]);

export const chatsUnlinkedTool = defineTool({
  name: "chats_unlinked",
  title: "List the unlinked messenger chats",
  description:
    "Lists the Telegram and WhatsApp chats the Hub saw that are linked to no client: channel, chat id, the chat's title, why no record matched, the newest message's time and side, and whether a hide is already proposed. Never message text. Use it to sort the chats, then chats_propose_hide for those that are not clients.",
  input: z.object({}),
  output: z.object({ project: z.string(), chats: z.array(z.object({ channel, chat_id: z.string(), title: z.string(), why: z.string(), last_at: z.string().nullable(), inbound: z.boolean().nullable(), proposed: z.boolean() })), next: z.string() }),
  effect: "read",
  refusals: ["unavailable", "failed"],
  handler: async ({ env, project }) => {
    const slug = project();
    if (!env.chatSort) throw new ToolError("unavailable", "This session cannot read the unlinked chats (the Hub server is not reachable).");
    const a = await env.chatSort.unlinked(slug);
    if (!a.ok) throw a.status === 0 ? unavailableAnswer(a.error) : new ToolError("failed", a.error);
    const chats = a.value.map((c) => ({ channel: c.channel, chat_id: c.chatId, title: c.title, why: c.why, last_at: c.lastAt, inbound: c.inbound, proposed: c.proposed }));
    return { project: slug, chats, next: chats.length === 0 ? "Tell the owner in one line that no unlinked chat waits." : "Decide per chat from its title and why: a shop, a bot, a group, spam or a private contact is not a client. Propose those with chats_propose_hide; leave a possible client alone." };
  },
});

export const chatsProposeHideTool = defineTool({
  name: "chats_propose_hide",
  title: "Propose hiding chats that are not clients",
  description:
    "Proposes \"Hide: not a client\" for unlinked chats (from chats_unlinked), each with a one-sentence reason the owner reads. Nothing is hidden: the owner reviews the whole list in one dialog on Messengers ▸ Not linked and confirms or keeps each. A chat the Hub no longer holds is skipped.",
  input: z.object({
    items: z.array(z.object({ channel, chat_id: z.string().regex(/^\+?\d{1,20}$/), reason: z.string().trim().min(1).max(200).describe("Why it is not a client, in one sentence, for the owner.") })).min(1).max(200),
  }),
  output: z.object({ project: z.string(), proposed: z.number(), skipped: z.number(), hidden: z.literal(0), next: z.string() }),
  effect: "pointer",
  refusals: ["unavailable", "invalid", "failed"],
  handler: async ({ env, project }, { items }) => {
    const slug = project();
    if (!env.chatSort) throw new ToolError("unavailable", "This session cannot propose hides (the Hub server is not reachable).");
    const a = await env.chatSort.propose(slug, items.map((i) => ({ channel: i.channel, chatId: i.chat_id, reason: i.reason })));
    if (!a.ok) throw a.status === 0 ? unavailableAnswer(a.error) : new ToolError(a.status === 400 ? "invalid" : "failed", a.error);
    return { project: slug, proposed: a.value.kept, skipped: a.value.skipped, hidden: 0 as const, next: `Tell the owner in one line: ${a.value.kept} ${a.value.kept === 1 ? "chat is" : "chats are"} proposed for hiding; he reviews them on Messengers ▸ Not linked. Nothing was hidden.` };
  },
});
