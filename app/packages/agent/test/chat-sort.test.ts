import { describe, expect, it } from "vitest";
import type { Repos } from "@hub/db";
import type { ChatSortPort } from "../src/messenger/chat-sort-port";
import { toolCtx } from "../src/mcp/ports";
import { chatsProposeHideTool, chatsUnlinkedTool } from "../src/mcp/tools/chat-sort";
import { clientCreateTool } from "../src/mcp/tools/conversation";

// P128 X5: the agent's chat sorting over a fake server port. Proposing hides nothing; a missing port refuses `unavailable`.

const CHATS = [{ channel: "telegram_user" as const, chatId: "3001", title: "Pizza Place", why: "none", lastAt: "2026-11-20T12:00:00.000Z", inbound: true, proposed: false }];

function fakePort(): { port: ChatSortPort; proposed: unknown[] } {
  const proposed: unknown[] = [];
  return {
    proposed,
    port: {
      unlinked: async () => ({ ok: true, value: CHATS }),
      propose: async (_slug, items) => {
        proposed.push(...items);
        return { ok: true, value: { kept: items.length, skipped: 0 } };
      },
      create: async () => ({ ok: false, status: 0, error: "not in this test" }),
      link: async () => ({ ok: false, status: 0, error: "not in this test" }),
    },
  };
}
const ctx = (chatSort?: ChatSortPort) => toolCtx({} as Repos, { hubProject: "acme", focusFile: "/nowhere", ...(chatSort ? { chatSort } : {}) });

describe("chats_unlinked and chats_propose_hide", () => {
  it("lists the unlinked chats by identity, in the tool's own names", async () => {
    const out = await chatsUnlinkedTool.handler(ctx(fakePort().port), {});
    expect(out.chats).toEqual([{ channel: "telegram_user", chat_id: "3001", title: "Pizza Place", why: "none", last_at: "2026-11-20T12:00:00.000Z", inbound: true, proposed: false }]);
  });

  it("proposes and says nothing was hidden", async () => {
    const f = fakePort();
    const out = await chatsProposeHideTool.handler(ctx(f.port), { items: [{ channel: "telegram_user", chat_id: "3001", reason: "A restaurant." }] });
    expect(out).toMatchObject({ project: "acme", proposed: 1, skipped: 0, hidden: 0 });
    expect(out.next).toContain("Nothing was hidden");
    expect(f.proposed).toEqual([{ channel: "telegram_user", chatId: "3001", reason: "A restaurant." }]);
  });

  it("refuses unavailable without the server's port", async () => {
    await expect(chatsUnlinkedTool.handler(ctx(), {})).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("P143: client_create with no chat", () => {
  const made = { ok: true as const, chat: null, clientId: null, name: "Ahmed, Qimma Auctions", how: "created" as const, notion: "Created Ahmed, Qimma Auctions in Notion with Phone", imported: 0, importError: null };
  function createPort(): { port: ChatSortPort; bodies: unknown[] } {
    const bodies: unknown[] = [];
    const f = fakePort().port;
    return { bodies, port: { ...f, create: async (_slug, body) => (bodies.push(body), { ok: true, value: made }) } };
  }
  const attendedCtx = (chatSort: ChatSortPort) => toolCtx({} as Repos, { hubProject: "acme", focusFile: "/nowhere", chatSort, agentSend: (async () => ({ ok: false, reason: "refused", error: "test", next: "test" })) as never });

  it("passes the name and the identities to the server's door and says no chat was linked", async () => {
    const p = createPort();
    const out = await clientCreateTool.handler(attendedCtx(p.port), { name: "Ahmed", company: "Qimma Auctions", phone: "+966 54 455 5430" });
    expect(p.bodies).toEqual([{ name: "Ahmed", company: "Qimma Auctions", phone: "+966 54 455 5430" }]);
    expect(out).toMatchObject({ project: "acme", chat: null, client: null, how: "created" });
    expect(out.next).toContain("with no chat linked");
  });

  it("refuses a name alone, phone or telegram beside a chat, and outside an attended session", async () => {
    const p = createPort();
    await expect(clientCreateTool.handler(attendedCtx(p.port), { name: "Ahmed" })).rejects.toMatchObject({ code: "invalid" });
    await expect(clientCreateTool.handler(attendedCtx(p.port), { chat: 4, name: "Ahmed", telegram: "qimma_k" })).rejects.toMatchObject({ code: "invalid" });
    await expect(clientCreateTool.handler(ctx(p.port), { name: "Ahmed", email: "ahmed@example.test" })).rejects.toMatchObject({ code: "unattended" });
    expect(p.bodies).toEqual([]);
  });
});
