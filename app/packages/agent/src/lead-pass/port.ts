import { AGENT_SEND_HEADER } from "../messenger/send-token";
import { HTTP_TOOL_LIMIT_MS, slowServerText, timedOut } from "../mcp/define";

// P147 F3 of 3d: `hub mcp`'s one loopback call for `lead_pass_start` (the dock's "process the leads"), with the token of the agent
// send (decision 0046). The server starts the same pass as the owner's Run lead pass now (trigger dock, the same 3 a day) and
// answers at once; the pass writes drafts and decisions only. Nothing here sends.

export type LeadPassRunAnswer = { ok: true; joined: boolean; state?: "running" | "finished" | "failed"; listed?: number | null; drafted?: number | null; failed?: number | null } | { ok: false; status: number; error: string };

export interface LeadPassPort {
  run(slug: string, pass?: "lead" | "mail", checkOnly?: boolean): Promise<LeadPassRunAnswer>;
}

export function httpLeadPass(o: { port: () => number; token: () => string | null; fetch?: typeof fetch }): LeadPassPort {
  const f = o.fetch ?? fetch;
  return {
    async run(slug, pass = "lead", checkOnly = false) {
      const token = o.token();
      if (!token) return { ok: false, status: 0, error: "The Hub server has not started (no agent token)." };
      const ms = HTTP_TOOL_LIMIT_MS.read;
      try {
        const r = await f(`http://127.0.0.1:${o.port()}/api/projects/${encodeURIComponent(slug)}/lead-pass/agent-run`, { method: "POST", headers: { "content-type": "application/json", [AGENT_SEND_HEADER]: token }, body: JSON.stringify({ pass, checkOnly }), signal: AbortSignal.timeout(ms) });
        const json = (await r.json().catch(() => null)) as { joined?: unknown; error?: unknown; state?: unknown; listed?: unknown; drafted?: unknown; failed?: unknown } | null;
        if (!r.ok) return { ok: false, status: r.status, error: typeof json?.error === "string" ? json.error : `The server answered ${r.status}.` };
        return { ok: true, joined: json?.joined === true, ...(json?.state === "running" || json?.state === "finished" || json?.state === "failed" ? { state: json.state } : {}), listed: typeof json?.listed === "number" ? json.listed : null, drafted: typeof json?.drafted === "number" ? json.drafted : null, failed: typeof json?.failed === "number" ? json.failed : null };
      } catch (e) {
        return { ok: false, status: 0, error: timedOut(e) ? slowServerText(ms) : `The Hub server did not answer (${e instanceof Error ? e.message : String(e)}).` };
      }
    },
  };
}

// P147 3m item 1, 3n: `mail_junk`'s loopback call, with the same agent send token. The server moves one inbound message to Mail's
// Junk or Trash (both recoverable) and takes it out of Needs you, with an Activity line; it refuses a known sender. Nothing is sent.

export type MailJunkAnswer = { ok: true; closed: number } | { ok: false; status: number; error: string };

export interface MailJunkPort {
  junk(slug: string, inboundId: number, to: "junk" | "trash"): Promise<MailJunkAnswer>;
}

export function httpMailJunk(o: { port: () => number; token: () => string | null; fetch?: typeof fetch }): MailJunkPort {
  const f = o.fetch ?? fetch;
  return {
    async junk(slug, inboundId, to) {
      const token = o.token();
      if (!token) return { ok: false, status: 0, error: "The Hub server has not started (no agent token)." };
      const ms = HTTP_TOOL_LIMIT_MS.read;
      try {
        const r = await f(`http://127.0.0.1:${o.port()}/api/projects/${encodeURIComponent(slug)}/mail/inbound/${inboundId}/agent-junk`, { method: "POST", headers: { [AGENT_SEND_HEADER]: token, "content-type": "application/json" }, body: JSON.stringify({ to }), signal: AbortSignal.timeout(ms) });
        const json = (await r.json().catch(() => null)) as { closed?: unknown; error?: unknown } | null;
        if (!r.ok) return { ok: false, status: r.status, error: typeof json?.error === "string" ? json.error : `The server answered ${r.status}.` };
        return { ok: true, closed: typeof json?.closed === "number" ? json.closed : 0 };
      } catch (e) {
        return { ok: false, status: 0, error: timedOut(e) ? slowServerText(ms) : `The Hub server did not answer (${e instanceof Error ? e.message : String(e)}).` };
      }
    },
  };
}
