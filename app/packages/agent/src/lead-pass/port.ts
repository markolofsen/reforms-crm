import { AGENT_SEND_HEADER } from "../messenger/send-token";
import { HTTP_TOOL_LIMIT_MS, slowServerText, timedOut } from "../mcp/define";

// P147 F3 of 3d: `hub mcp`'s one loopback call for `lead_pass_start` (the dock's "process the leads"), with the token of the agent
// send (decision 0046). The server starts the same pass as the owner's Run lead pass now (trigger dock, the same 3 a day) and
// answers at once; the pass writes drafts and decisions only. Nothing here sends.

export type LeadPassRunAnswer = { ok: true; joined: boolean } | { ok: false; status: number; error: string };

export interface LeadPassPort {
  run(slug: string, pass?: "lead" | "mail"): Promise<LeadPassRunAnswer>;
}

export function httpLeadPass(o: { port: () => number; token: () => string | null; fetch?: typeof fetch }): LeadPassPort {
  const f = o.fetch ?? fetch;
  return {
    async run(slug, pass = "lead") {
      const token = o.token();
      if (!token) return { ok: false, status: 0, error: "The Hub server has not started (no agent token)." };
      const ms = HTTP_TOOL_LIMIT_MS.read;
      try {
        const r = await f(`http://127.0.0.1:${o.port()}/api/projects/${encodeURIComponent(slug)}/lead-pass/agent-run`, { method: "POST", headers: { "content-type": "application/json", [AGENT_SEND_HEADER]: token }, body: JSON.stringify({ pass }), signal: AbortSignal.timeout(ms) });
        const json = (await r.json().catch(() => null)) as { joined?: unknown; error?: unknown } | null;
        if (!r.ok) return { ok: false, status: r.status, error: typeof json?.error === "string" ? json.error : `The server answered ${r.status}.` };
        return { ok: true, joined: json?.joined === true };
      } catch (e) {
        return { ok: false, status: 0, error: timedOut(e) ? slowServerText(ms) : `The Hub server did not answer (${e instanceof Error ? e.message : String(e)}).` };
      }
    },
  };
}
