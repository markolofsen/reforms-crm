import type { Ctx } from "./context";

const H = { "content-type": "application/json", accept: "application/json, text/event-stream" };

/** Parse a JSON-RPC reply that may arrive as plain JSON or as one SSE "data:" line. */
/** A JSON-RPC reply of an MCP tools/call, its fields as far as the probe reads them. */
export type RpcReply = { error?: { message?: unknown }; result?: { isError?: boolean; content?: Array<{ text?: string }> } };

export function parseRpc(text: string): RpcReply {
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : text) as RpcReply;
}

/** Minimal streamable-HTTP MCP client: initialize, then one tools/call. Read-only use only. */
export async function mcpCall(ctx: Ctx, url: string, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  const post = async (body: unknown, sid?: string | null) => {
    const r = await ctx.fetch(url, {
      method: "POST",
      headers: { ...H, ...(sid ? { "mcp-session-id": sid } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000), // Mail.app can take a while to search a large mailbox
    });
    return { sid: r.headers.get("mcp-session-id"), text: await r.text() };
  };
  try {
    const i = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hub-doctor", version: "0" } } });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, i.sid);
    const r = parseRpc((await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }, i.sid)).text);
    if (r.error) return { ok: false, text: String(r.error.message ?? "error") };
    const text = (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
    return { ok: !r.result?.isError, text };
  } catch (e) {
    return { ok: false, text: `${(e as Error).message}` };
  }
}

export async function mcpReachable(ctx: Ctx, url: string): Promise<boolean> {
  try {
    const r = await ctx.fetch(url, {
      method: "POST", headers: H, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "hub-doctor", version: "0" } } }),
    });
    return r.ok;
  } catch { return false; }
}
