import { AUTOPILOT_VERDICTS, type AutopilotVerdict } from "@hub/config/autopilot";

// The `stream-json --verbose` output of one autopilot turn (Claude Code 2.1.220, A0), read line by line. Pure, so a test feeds it
// recorded lines. What the brain needs from it:
// - the `init` event: the `hub` server's status and the tools the turn really has (rule 4: exactly the six, else no turn);
// - each `messenger_draft_write` call (the `tool_use` block's input: the text and the verdict) and its answer (the `tool_result`:
//   the draft id, or a refusal), so the draft a send goes out on is the one this turn wrote, never a row read back;
// - the `result` event: `is_error` (rule 5: never `subtype`), the notional cost and the permission denials.

export const DRAFT_TOOL = "mcp__hub__messenger_draft_write";

export interface StreamInit {
  hub: string | null;
  tools: string[];
}

export interface StreamDraft {
  draftId: number;
  text: string;
  verdict: AutopilotVerdict;
  reason: string;
}

export interface StreamFinal {
  isError: boolean;
  costUsd: number | null;
  denials: number;
  /** The model's last words (cut), the reason of a turn that wrote no draft. */
  result: string;
  subtype: string | null;
}

export interface TurnStream {
  init: StreamInit | null;
  /** The last draft write the hub answered with a draft id. */
  draft: StreamDraft | null;
  final: StreamFinal | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The text of a `tool_result`'s content: a string, or an array of text blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return arr(content)
    .map((b) => str(obj(b)?.text) ?? "")
    .join("");
}

export function turnStream(): { push(line: string): StreamInit | null; done(): TurnStream } {
  const s: TurnStream = { init: null, draft: null, final: null };
  const calls = new Map<string, { text: string; verdict: AutopilotVerdict; reason: string }>();
  return {
    /** One line of stdout; returns the init event when this line was it. */
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
          if (!b || str(b.type) !== "tool_use" || str(b.name) !== DRAFT_TOOL) continue;
          const input = obj(b.input);
          const ap = obj(input?.autopilot);
          const verdict = str(ap?.verdict);
          const id = str(b.id);
          const text = str(input?.text);
          if (id && text !== null && verdict && (AUTOPILOT_VERDICTS as readonly string[]).includes(verdict)) calls.set(id, { text: text.trim(), verdict: verdict as AutopilotVerdict, reason: str(ap?.reason)?.trim() ?? "" });
        }
      } else if (type === "user") {
        for (const b of content) {
          if (!b || str(b.type) !== "tool_result") continue;
          const call = calls.get(str(b.tool_use_id) ?? "");
          if (!call || b.is_error === true) continue;
          let answer: Record<string, unknown> | null = null;
          try {
            answer = obj(JSON.parse(resultText(b.content)));
          } catch {
            answer = null;
          }
          const draftId = answer?.draft;
          if (typeof draftId === "number" && Number.isInteger(draftId) && draftId > 0 && answer?.error === undefined) s.draft = { draftId, ...call };
        }
      } else if (type === "result") {
        const cost = ev.total_cost_usd;
        s.final = {
          isError: ev.is_error === true,
          costUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
          denials: arr(ev.permission_denials).length,
          result: (str(ev.result) ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
          subtype: str(ev.subtype),
        };
      }
      return null;
    },
    done: () => s,
  };
}

/** Rule 4: the turn runs only when `hub` is connected and its tools are exactly `allowed` (no built-in tool, no other hub tool). */
export function initRefusal(init: StreamInit, allowed: readonly string[]): string | null {
  if (init.hub !== "connected") return `the hub MCP server was ${init.hub ?? "absent"} at the start of the turn`;
  const have = [...new Set(init.tools)].sort();
  const want = [...new Set(allowed)].sort();
  if (have.length !== want.length || have.some((t, i) => t !== want[i])) return `the turn's tools were ${have.join(", ") || "none"}, not ${want.join(", ")}`;
  return null;
}
