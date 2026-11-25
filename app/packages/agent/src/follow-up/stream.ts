import { AUTOPILOT_VERDICTS } from "@hub/config/autopilot";
import { FOLLOW_UP_DECISIONS, type FollowUpDecision } from "@hub/config/follow-ups";

// The `stream-json --verbose` output of one sweep turn (P142 F4), read line by line, pure. What the runner needs from it: the init
// event (the hub server connected and exactly the nine tools), the turn's own `follow_up_plan` call that the hub answered, the
// `messenger_draft_write` call with `follow_up` the hub answered with a draft id (its text, `send_after` and autopilot's verdict),
// and the result event. A send is decided on what this stream carried, never on a row read back (decision 0048 point 2).

export const PLAN_TOOL = "mcp__hub__follow_up_plan";
export const CHAT_DRAFT_TOOL = "mcp__hub__messenger_draft_write";

export interface SweepStream {
  init: { hub: string | null; tools: string[] } | null;
  decision: FollowUpDecision | null;
  nudge: { draftId: number; text: string; sendAfter: string | null; chat: number | null; send: boolean } | null;
  final: { isError: boolean; costUsd: number | null; denials: number; result: string; subtype: string | null } | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const resultText = (c: unknown): string => (typeof c === "string" ? c : arr(c).map((b) => str(obj(b)?.text) ?? "").join(""));
const answerOf = (b: Record<string, unknown>): Record<string, unknown> | null => {
  try {
    return obj(JSON.parse(resultText(b.content)));
  } catch {
    return null;
  }
};

export function sweepStream(): { push(line: string): SweepStream["init"]; done(): SweepStream } {
  const s: SweepStream = { init: null, decision: null, nudge: null, final: null };
  const plans = new Map<string, FollowUpDecision>();
  const drafts = new Map<string, { text: string; sendAfter: string | null; chat: number | null; send: boolean }>();
  return {
    push(line) {
      let ev: Record<string, unknown> | null;
      try {
        ev = obj(JSON.parse(line));
      } catch {
        return null;
      }
      if (!ev) return null;
      const type = str(ev.type);
      if (type === "system" && str(ev.subtype) === "init") {
        const hub = arr(ev.mcp_servers).map(obj).find((m) => m && str(m.name) === "hub");
        s.init = { hub: hub ? str(hub.status) : null, tools: arr(ev.tools).map(str).filter((t): t is string => t !== null) };
        return s.init;
      }
      const content = arr(obj(ev.message)?.content).map(obj);
      if (type === "assistant") {
        for (const b of content) {
          if (!b || str(b.type) !== "tool_use") continue;
          const id = str(b.id);
          const input = obj(b.input);
          if (!id || !input) continue;
          const d = str(input.decision);
          if (str(b.name) === PLAN_TOOL && d && (FOLLOW_UP_DECISIONS as readonly string[]).includes(d)) plans.set(id, d as FollowUpDecision);
          if (str(b.name) === CHAT_DRAFT_TOOL && obj(input.follow_up)) {
            const v = str(obj(input.autopilot)?.verdict);
            const chat = typeof input.chat === "number" ? input.chat : null;
            drafts.set(id, { text: (str(input.text) ?? "").trim(), sendAfter: str(input.send_after), chat, send: v === "send" && (AUTOPILOT_VERDICTS as readonly string[]).includes(v) });
          }
        }
      } else if (type === "user") {
        for (const b of content) {
          if (!b || str(b.type) !== "tool_result" || b.is_error === true) continue;
          const id = str(b.tool_use_id) ?? "";
          const a = answerOf(b);
          if (!a || a.error !== undefined) continue;
          const plan = plans.get(id);
          if (plan) s.decision = plan;
          const dr = drafts.get(id);
          if (dr && typeof a.draft === "number" && Number.isInteger(a.draft) && a.draft > 0) s.nudge = { draftId: a.draft, ...dr };
        }
      } else if (type === "result") {
        const cost = ev.total_cost_usd;
        s.final = { isError: ev.is_error === true, costUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null, denials: arr(ev.permission_denials).length, result: (str(ev.result) ?? "").replace(/\s+/g, " ").trim().slice(0, 300), subtype: str(ev.subtype) };
      }
      return null;
    },
    done: () => s,
  };
}
