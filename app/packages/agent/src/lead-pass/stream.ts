import { LEAD_PASS_DECISIONS, MAIL_PASS_DECISIONS, type PassDecision, type PassKind } from "@hub/config/lead-pass";

// The `stream-json --verbose` output of one lead turn (P147 L4), read line by line, pure: the init event (the hub server connected
// with exactly the six tools), the turn's own `lead_decide` call that the hub answered without a refusal, and the result event.

export const DECIDE_TOOL = "mcp__hub__lead_decide";
export const MAIL_DECIDE_TOOL = "mcp__hub__mail_decide";

export interface LeadStream {
  init: { hub: string | null; tools: string[] } | null;
  decision: PassDecision | null;
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

export function leadStream(kind: PassKind = "lead"): { push(line: string): LeadStream["init"]; done(): LeadStream } {
  const s: LeadStream = { init: null, decision: null, final: null };
  const calls = new Map<string, PassDecision>();
  const tool = kind === "mail" ? MAIL_DECIDE_TOOL : DECIDE_TOOL;
  const allowed: readonly string[] = kind === "mail" ? MAIL_PASS_DECISIONS : LEAD_PASS_DECISIONS;
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
          if (!b || str(b.type) !== "tool_use" || str(b.name) !== tool) continue;
          const id = str(b.id);
          const d = str(obj(b.input)?.decision);
          if (id && d && allowed.includes(d)) calls.set(id, d as PassDecision);
        }
      } else if (type === "user") {
        for (const b of content) {
          if (!b || str(b.type) !== "tool_result" || b.is_error === true) continue;
          const d = calls.get(str(b.tool_use_id) ?? "");
          const a = answerOf(b);
          if (d && a && a.error === undefined) s.decision = d;
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
