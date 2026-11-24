import type { AutopilotBrain, BrainResult, BrainTurn, TurnSignal } from "@hub/config/autopilot";
import type { Repos } from "@hub/db";
import { recordAgentDraft } from "../messenger/record";

// A brain with no model (P139 A7, verdict 24): the e2e run's `HUB_AUTOPILOT_BRAIN=fake` (the server wires it only with a
// throwaway `HUB_DB`) and the unit tests. It reads the chat's newest client message and answers by a fixed script, through
// the same recorder as a real turn's `messenger_draft_write`:
// - a question about a price (`price`, `cost`, `цена`, `сколько`) is drafted and handed back;
// - "are you a bot" (`bot`, `бот`) writes nothing and hands back;
// - anything else is drafted with the verdict `send`.

export interface FakeBrainDeps {
  /** Repositories on a write connection (the server's own). */
  repos: Repos;
  now?: () => Date;
}

const PRICE = /price|cost|цен|сколько/i;
const BOT = /\bbot\b|бот/i;

export function fakeBrain(d: FakeBrainDeps): AutopilotBrain {
  return {
    name: "fake",
    async turn(t: BrainTurn, signal: TurnSignal): Promise<BrainResult> {
      if (signal.aborted) return { kind: "failed", code: "failed", detail: "aborted" };
      const row = await d.repos.messengers.chatById(t.chat.project, t.chat.chat);
      if (!row) return { kind: "failed", code: "failed", detail: `no chat ${t.chat.chat}` };
      const [newest] = (await d.repos.messengers.messagesOf(t.chat.project, [{ channel: row.channel, chatId: row.chatId }], { limit: 20 })).filter((m) => m.direction === "in");
      const said = newest?.text ?? "";
      if (BOT.test(said)) return { kind: "no_draft", reason: "the client asked whether this is a bot", costUsd: 0 };
      const handBack = PRICE.test(said);
      const text = `${handBack ? "Let me check the price for you." : `Thanks, noted: ${said.slice(0, 60)}`}${t.disclose ? "\n— Mark's assistant" : ""}`;
      const clientId = await d.repos.messengers.clientByIdentifier(t.chat.project, row.channel === "whatsapp" ? "whatsapp" : "telegram", row.chatId);
      const { id } = await recordAgentDraft(d.repos, {
        project: t.chat.project,
        chat: row,
        client: clientId === null ? null : { id: clientId, name: null },
        text,
        provider: "autopilot",
        ownerRequest: null,
        nudge: false,
        ...(t.revise !== null ? { revise: t.revise } : {}),
        at: (d.now ?? (() => new Date()))().toISOString(),
        autopilot: { verdict: handBack ? "hand_back" : "send", reason: handBack ? "the client asked about a price" : "a plain answer" },
      });
      return { kind: "draft", draftId: id, text, verdict: handBack ? "hand_back" : "send", reason: handBack ? "the client asked about a price" : "a plain answer", costUsd: 0 };
    },
  };
}
