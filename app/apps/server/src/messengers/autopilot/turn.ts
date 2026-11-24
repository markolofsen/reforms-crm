import type { AutopilotBrain, BrainResult } from "@hub/config/autopilot";
import type { Turn, TurnResult } from "./scheduler";

// One autopilot turn after the scheduler started it (P139 A2, A3): the brain writes a draft and gives its verdict; this maps the
// verdict to the turn's outcome. It sends nothing itself. A `send` verdict in mode `on` goes to A4's `deliver` (`deliver.ts`: the
// mechanical limits, the pre-send re-checks, the read delay, the typing status, then `applyMessenger` with the `autopilot`
// authority). No code judges the text: the `autopilot-reply` skill's rules do (owner, 2026-11-24).

/** A4's step after a `send` verdict in mode `on`: everything up to and through the door. */
export type AutopilotDeliver = (turn: Turn, draft: Extract<BrainResult, { kind: "draft" }>, signal: AbortSignal) => Promise<TurnResult>;

export interface TurnRunnerDeps {
  /** Absent: this server has no brain (a test's wiring), and every turn is `skipped: no_brain`. */
  brain?: AutopilotBrain | undefined;
  deliver?: AutopilotDeliver | undefined;
  /** P143 D3: whether the turn's chat is marked no reply needed now (the turn's own `conversation_done`); absent: never. */
  isDone?: ((turn: Turn) => Promise<boolean>) | undefined;
}

export function turnRunner(d: TurnRunnerDeps): (turn: Turn, signal: AbortSignal) => Promise<TurnResult> {
  return async (turn, signal) => {
    if (!d.brain) return { outcome: "skipped", reason: "no_brain" };
    const r = await d.brain.turn({ chat: turn.chat, actionId: turn.actionId, burst: turn.burst, mode: turn.mode, revise: turn.revise, disclose: turn.disclose }, signal);
    // The wall clock is the model's (verdict 19): the pacing and the door after it are never cut by it.
    turn.brainReturned();
    switch (r.kind) {
      case "failed":
        return { outcome: "refused", reason: "brain_failed", note: r.detail, costUsd: r.costUsd ?? null };
      case "no_draft":
        // P143 D3: the turn closed the chat as no reply needed ("yes", "thanks"): nothing to hand back, the chat stays on.
        if (await d.isDone?.(turn).catch(() => false)) return { outcome: "skipped", reason: "done", note: r.reason, costUsd: r.costUsd };
        return { outcome: "handed_back", reason: "model_hand_back", note: r.reason, costUsd: r.costUsd };
      case "draft": {
        const base = { costUsd: r.costUsd, draftId: r.draftId, note: r.reason };
        if (r.verdict === "hand_back") return { ...base, outcome: "handed_back", reason: "model_hand_back" };
        if (turn.mode === "dry_run") return { ...base, outcome: "dry_run", reason: null };
        if (!d.deliver) return { ...base, outcome: "skipped", reason: "no_sender" };
        return { ...base, ...(await d.deliver(turn, r, signal)) };
      }
      default:
        return unreachable(r);
    }
  };
}

function unreachable(r: never): never {
  throw new Error(`unknown brain result ${JSON.stringify(r)}`);
}
