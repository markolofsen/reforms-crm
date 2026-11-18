import { isTelegramToken } from "./kinds";

/** valid: the service accepted it. invalid: it refused it. unverified: could not be asked (offline). `identity` is the provider's public name for the key. */
export interface Verdict { state: "valid" | "invalid" | "unverified"; detail: string; identity?: string }

/** The only outside calls. Tests inject fakes; no probe returns, throws or logs a secret (only `error.name` ever leaves a failed call). */
export interface ProbeDeps { fetch: typeof fetch }

const TIMEOUT_MS = 15_000;

export async function probeNotion(deps: ProbeDeps, token: string): Promise<Verdict> {
  try {
    const r = await deps.fetch("https://api.notion.com/v1/users/me", {
      headers: { authorization: `Bearer ${token}`, "notion-version": "2025-09-03" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status === 401) return { state: "invalid", detail: "Notion rejected the token (401)" };
    if (!r.ok) return { state: "unverified", detail: `Notion answered ${r.status}` };
    const j = (await r.json().catch(() => ({}))) as { name?: unknown };
    return { state: "valid", detail: "GET /users/me answered", ...(typeof j.name === "string" && j.name ? { identity: j.name } : {}) };
  } catch (e) {
    return { state: "unverified", detail: `cannot reach Notion (${e instanceof Error ? e.name : "error"})` };
  }
}

export async function probeTelegram(deps: ProbeDeps, token: string): Promise<Verdict> {
  if (!isTelegramToken(token)) return { state: "invalid", detail: "not a bot token (expected <digits>:<secret>)" };
  try {
    // The URL carries the token: it is never put in a message.
    const r = await deps.fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status === 401 || r.status === 404) return { state: "invalid", detail: `Telegram rejected the token (${r.status})` };
    if (!r.ok) return { state: "unverified", detail: `Telegram answered ${r.status}` };
    const j = (await r.json().catch(() => ({}))) as { result?: { username?: string } };
    const u = j.result?.username;
    return u ? { state: "valid", detail: `bot @${u}`, identity: `@${u}` } : { state: "valid", detail: "getMe answered" };
  } catch (e) {
    return { state: "unverified", detail: `cannot reach Telegram (${e instanceof Error ? e.name : "error"})` };
  }
}
