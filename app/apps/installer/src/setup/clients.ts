import { imapflowConnect, redactSecrets, type ImapAccount, type ImapConnect } from "@hub/mail/imap";
import type { Ctx } from "../context.ts";

/** valid: the service accepted it. invalid: it refused it. unverified: could not be asked (offline, CLI missing). */
export interface Verdict { state: "valid" | "invalid" | "unverified"; detail: string }

/** Every outside call of the wizard. Tests inject fakes; none of them ever prints or returns a secret. */
export interface Validators {
  notion(token: string): Promise<Verdict>;
  telegram(token: string): Promise<Verdict>;
  imap(account: ImapAccount): Promise<Verdict>;
}

export const TELEGRAM_SHAPE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

export function makeValidators(ctx: Ctx, imapConnect: ImapConnect = imapflowConnect): Validators {
  return {
    async notion(token) {
      try {
        const r = await ctx.fetch("https://api.notion.com/v1/users/me", {
          headers: { authorization: `Bearer ${token}`, "notion-version": "2025-09-03" },
          signal: AbortSignal.timeout(15_000),
        });
        if (r.status === 401) return { state: "invalid", detail: "Notion rejected the token (401)" };
        return r.ok ? { state: "valid", detail: "GET /users/me answered" } : { state: "unverified", detail: `Notion answered ${r.status}` };
      } catch (e) {
        return { state: "unverified", detail: `cannot reach Notion (${(e as Error).name})` };
      }
    },
    async telegram(token) {
      if (!TELEGRAM_SHAPE.test(token)) return { state: "invalid", detail: "not a bot token (expected <digits>:<secret>)" };
      try {
        const r = await ctx.fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(15_000) });
        if (r.status === 401 || r.status === 404) return { state: "invalid", detail: `Telegram rejected the token (${r.status})` };
        if (!r.ok) return { state: "unverified", detail: `Telegram answered ${r.status}` };
        const j = (await r.json().catch(() => ({}))) as { result?: { username?: string } };
        return { state: "valid", detail: j.result?.username ? `bot @${j.result.username}` : "getMe answered" };
      } catch (e) {
        return { state: "unverified", detail: `cannot reach Telegram (${(e as Error).name})` };
      }
    },
    async imap(account) {
      try {
        const s = await imapConnect(account);
        try { await s.list(); } finally { await s.close().catch(() => {}); }
        return { state: "valid", detail: `logged in to ${account.host} and listed mailboxes (read-only)` };
      } catch (e) {
        const msg = redactSecrets(e instanceof Error ? e.message : String(e), [account]);
        const refused = (e as { authenticationFailed?: boolean })?.authenticationFailed === true || /auth|login|credential|password/i.test(msg);
        return refused
          ? { state: "invalid", detail: `${account.host} refused the login` }
          : { state: "unverified", detail: `cannot reach ${account.host}:${account.port}` };
      }
    },
  };
}
