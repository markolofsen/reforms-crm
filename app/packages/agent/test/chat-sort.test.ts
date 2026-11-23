import { describe, expect, it } from "vitest";
import type { Repos } from "@hub/db";
import type { ChatSortPort } from "../src/messenger/chat-sort-port";
import { toolCtx } from "../src/mcp/ports";
import { chatsProposeHideTool, chatsUnlinkedTool } from "../src/mcp/tools/chat-sort";

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
