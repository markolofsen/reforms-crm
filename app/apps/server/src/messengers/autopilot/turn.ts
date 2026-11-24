import type { AutopilotBrain, BrainResult } from "@hub/config/autopilot";
import type { Turn, TurnResult } from "./scheduler";

// One autopilot turn after the scheduler started it (P139 A2): the brain writes a draft and gives its verdict; this maps the
// verdict to the turn's outcome. It sends nothing. The send is A4's `deliver` (the code guard, the pre-send re-checks, the read
// delay, the typing status, then `applyMessenger` with the `autopilot` authority); until it exists, a `send` verdict in mode `on`
// ends as `skipped: no_sender` and the draft waits for the owner's Send, as in a dry run.

/** A4's step after a `send` verdict in mode `on`: everything up to and through the door. */
export type AutopilotDeliver = (turn: Turn, draft: Extract<BrainResult, { kind: "draft" }>, signal: AbortSignal) => Promise<TurnResult>;

export interface TurnRunnerDeps {
  /** Absent: this server has no brain yet (until A3), and every turn is `skipped: no_brain`. */
  brain?: AutopilotBrain | undefined;
  deliver?: AutopilotDeliver | undefined;
}

export function turnRunner(d: TurnRunnerDeps): (turn: Turn, signal: AbortSignal) => Promise<TurnResult> {
  return async (turn, signal) => {
    if (!d.brain) return { outcome: "skipped", reason: "no_brain" };
    const r = await d.brain.turn({ chat: turn.chat, actionId: turn.actionId, burst: turn.burst, mode: turn.mode }, signal);
    switch (r.kind) {
      case "failed":
        return { outcome: "refused", reason: "brain_failed" };
      case "no_draft":
        return { outcome: "handed_back", reason: "model_hand_back", costUsd: r.costUsd };
      case "draft": {
        const base = { costUsd: r.costUsd, draftId: r.draftId };
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
