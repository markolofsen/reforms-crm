import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { run, ToolError } from "../mcp/result";
import { AGENT_SEND_HEADER } from "./send-token";

// `messenger_send` (decision 0046, P132 B1-2): in an ATTENDED session only, the agent sends one messenger draft after the owner
// told it to in this session ("отправь", "send it"). The tool names the chat and the draft, nothing else: the server finds the
// owner's word in the session log and sends through the same door as the owner's Send (inbound first, Stop sending, cap and
// spacing, `draft.recipients`, `send_log` with `actor: agent_on_owner_word`). `hub mcp` registers it only when the instance is
// not unattended; the deny list, Codex `disabled_tools` and `hub guard` refuse it in unattended sessions. Mail has no send tool.

export const MESSENGER_SEND_TOOL = "messenger_send";

/** The server's answer, through `hub mcp`'s loopback call with its token. */
export type AgentSendAnswer =
  | { ok: true; sendId: number; channel: string; chatId: string; to: string; text: string; at: string }
  | { ok: false; status: number; reason: string; error: string; next: string };

/** Asks the server to send draft `draft` of chat `chat` of the bound project. */
export type AgentSendPort = (slug: string, draft: number, chat: number) => Promise<AgentSendAnswer>;

const WORD: Record<string, string> = { telegram_user: "Telegram", telegram_bot: "Telegram bot", whatsapp: "WhatsApp" };
const excerpt = (t: string): string => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length <= 80 ? one : `${one.slice(0, 79)}…`;
};
const hhmm = (iso: string): string => iso.slice(11, 16);

/** The one line the agent says in the dock after a send: what, to whom, where and when. */
export const sentLine = (a: { to: string; channel: string; text: string; at: string }): string => `Sent to ${a.to} on ${WORD[a.channel] ?? a.channel} at ${hhmm(a.at)} UTC: "${excerpt(a.text)}"`;

export function registerMessengerSend(server: McpServer, env: { project: () => string; send: AgentSendPort }): void {
  server.registerTool(
    MESSENGER_SEND_TOOL,
    {
      title: "Send one messenger draft on the owner's word",
      description:
        "Sends ONE open messenger draft (Telegram, WhatsApp) only after the owner told you to in this session (\"отправь\", \"send it\") for this chat, after the draft was written. Pass `chat` (chat:<id> from focus or messenger_history) and `draft` (its open_draft id). The Hub checks his word in the session log and sends through the same checks as his Send button; one send per word. Never call it on your own initiative, never twice for one word, never for Mail (no tool sends Mail). A refusal has a code and a next step: follow it, never retry.",
      inputSchema: z.object({
        chat: z.number().int().positive().describe("The internal messenger chat id, for example 3 for chat:3."),
        draft: z.number().int().positive().describe("The open draft's id in that chat (messenger_history's open_draft.id)."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    ({ chat, draft }) =>
      run(async () => {
        const slug = env.project();
        const a = await env.send(slug, draft, chat);
        if (!a.ok) throw new ToolError(a.reason, `${a.error} Next: ${a.next}`);
        return { project: slug, sent: true, send_id: a.sendId, channel: a.channel, chat, draft, to: a.to, at: a.at, next: `Tell the owner exactly this one line: ${sentLine(a)}. Activity lists it as Agent (your word).` };
      }),
  );
}

/** `hub mcp`'s port: a loopback POST to the server's agent send route with the token from `state/secrets`. */
export function httpAgentSend(o: { port: () => number; token: () => string | null; fetch?: typeof fetch }): AgentSendPort {
  const f = o.fetch ?? fetch;
  return async (slug, draft, chat) => {
    const token = o.token();
    if (!token) return { ok: false, status: 0, reason: "unavailable", error: "Not sent: the Hub server has not started (no agent send token).", next: "Tell the owner in one line that the Hub server is not running; the draft waits." };
    let r: Response;
    try {
      r = await f(`http://127.0.0.1:${o.port()}/api/projects/${encodeURIComponent(slug)}/messengers/drafts/${draft}/agent-send`, { method: "POST", headers: { "content-type": "application/json", [AGENT_SEND_HEADER]: token }, body: JSON.stringify({ chat }), signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      return { ok: false, status: 0, reason: "unavailable", error: `Not sent: the Hub server did not answer (${e instanceof Error ? e.message : String(e)}).`, next: "Tell the owner in one line; never retry: a send may have started." };
    }
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok && body.ok === true) return body as AgentSendAnswer & { ok: true };
    return { ok: false, status: r.status, reason: typeof body.reason === "string" ? body.reason : "refused", error: typeof body.error === "string" ? body.error : `Not sent (HTTP ${r.status}).`, next: typeof body.next === "string" ? body.next : "Leave the draft for the owner." };
  };
}
