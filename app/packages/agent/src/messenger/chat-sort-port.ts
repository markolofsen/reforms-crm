import { agentUnlinkedDto, autolinkProposedDto, type AgentUnlinkedDto } from "@hub/contract/messengers";
import { AGENT_SEND_HEADER } from "./send-token";

// P128 X5 ("sort the chats"): `hub mcp`'s two loopback calls for `chats_unlinked` and `chats_propose_hide`
// (`../mcp/tools/chat-sort.ts`), with the token of the agent send (decision 0046). The server holds the unlinked chats in
// memory only (decision 0036 point 3); the agent reads their identities and proposes hides; the owner confirms them in one
// dialog. Neither call hides, links or sends.

export type UnlinkedChat = AgentUnlinkedDto["chats"][number];
export type ChatSortAnswer<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export interface ChatSortPort {
  unlinked(slug: string): Promise<ChatSortAnswer<UnlinkedChat[]>>;
  propose(slug: string, items: readonly { channel: UnlinkedChat["channel"]; chatId: string; reason: string }[]): Promise<ChatSortAnswer<{ kept: number; skipped: number }>>;
}

export function httpChatSort(o: { port: () => number; token: () => string | null; fetch?: typeof fetch }): ChatSortPort {
  const f = o.fetch ?? fetch;
  async function call<T>(slug: string, path: string, body: unknown, pick: (json: unknown) => T): Promise<ChatSortAnswer<T>> {
    const token = o.token();
    if (!token) return { ok: false, status: 0, error: "The Hub server has not started (no agent token)." };
    try {
      const r = await f(`http://127.0.0.1:${o.port()}/api/projects/${encodeURIComponent(slug)}/messengers/autolink/${path}`, { method: "POST", headers: { "content-type": "application/json", [AGENT_SEND_HEADER]: token }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      const json: unknown = await r.json().catch(() => null);
      if (!r.ok) return { ok: false, status: r.status, error: errorOf(json) ?? `The server answered ${r.status}.` };
      return { ok: true, value: pick(json) };
    } catch (e) {
      return { ok: false, status: 0, error: `The Hub server did not answer (${e instanceof Error ? e.message : String(e)}).` };
    }
  }
  return {
    unlinked: (slug) => call(slug, "agent-unlinked", {}, (j) => agentUnlinkedDto.parse(j).chats),
    propose: (slug, items) => call(slug, "agent-proposals", { items }, (j) => {
      const { kept, skipped } = autolinkProposedDto.parse(j);
      return { kept, skipped };
    }),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const errorOf = (v: unknown): string | null => (isObj(v) && typeof v.error === "string" ? v.error : null);
