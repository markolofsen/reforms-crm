import { existsSync, readFileSync, statSync } from "node:fs";
import { isTelegramToken, probeTelegram, TELEGRAM_FILE } from "@hub/connections";
import path from "node:path";
import type { Step } from "../types";
import { fail, pass, warn } from "./helpers";

const TOKEN = (configDir: string) => path.join(configDir, TELEGRAM_FILE);
const HEALTH = `http://127.0.0.1:${process.env.HUB_PORT ?? "4317"}/api/health`;
const STALE_MS = 5 * 60_000;

interface Health {
  ok?: boolean;
  messengers?: { state?: string; reason?: string; project?: string; lastPollAt?: string; lastError?: string };
  whatsapp?: { state?: string; accounts?: unknown[]; appHistory?: { state?: string; reason?: string | null; detail?: string | null; fix?: string | null; cacheDays?: number } };
}

/** `GET /api/health` of the local server, or why it could not be read. */
async function health(fetch: typeof globalThis.fetch): Promise<Health | string> {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return `server answered ${r.status}`;
    return (await r.json()) as Health;
  } catch {
    return "the local server is not running (start it with `pnpm --filter @hub/server start`)";
  }
}

/** Messengers are optional: both steps WARN rather than fail when the feature is simply not set up. */
export const messengerSteps: Step[] = [
  {
    id: "messengers.token", group: "Messengers", title: "Telegram bot token for the receive-only poller (optional)",
    why: "The local app can read Telegram messages from clients you allow-listed and show them beside the mail history. That needs a NEW bot made for this app (never a bot that already has a webhook): a webhook and long polling exclude each other. Without the token the feature stays off, and nothing else is affected.",
    verifies: "`state/secrets/telegram-bot-token` holds one `<digits>:<secret>` line and is mode 600. The value is never printed.",
    manual: { steps: [
      "Open @BotFather in Telegram, send /newbot and make a bot just for this app.",
      "Store the token alone in `state/secrets/telegram-bot-token` (`pnpm hub token telegram` if available, otherwise paste into the file) and run `chmod 600` on it.",
    ] },
    async check(ctx) {
      const f = TOKEN(ctx.configDir);
      if (!existsSync(f)) return warn("no bot token file: messengers stay off (optional)");
      if ((statSync(f).mode & 0o077) !== 0) return fail(`${f} is readable by others: chmod 600`);
      return isTelegramToken(readFileSync(f, "utf8").trim()) ? pass("token file present, mode 600, shape ok") : fail(`${f} does not hold a Telegram bot token (expected <digits>:<secret>)`);
    },
  },
  {
    id: "telegram.getme", group: "Messengers", title: "Telegram accepts the bot token",
    why: "A token that has the right shape can still be revoked, mistyped or belong to a bot that was deleted. Only Telegram can say.",
    verifies: "Telegram's `getMe` answers for the token in `state/secrets/telegram-bot-token` (one read-only call; the bot's @name is shown, the token never). WARN when there is no token file (the feature is off) or Telegram cannot be reached; FAIL when Telegram refuses the token or the shape is wrong.",
    manual: { steps: ["If Telegram refuses the token: in @BotFather send /token (or /revoke) for the bot, then store the new one with `pnpm hub token telegram`."] },
    async check(ctx) {
      const f = TOKEN(ctx.configDir);
      if (!existsSync(f)) return warn("no bot token file: messengers stay off (optional)");
      const token = readFileSync(f, "utf8").trim();
      if (!isTelegramToken(token)) return fail(`${f} does not hold a Telegram bot token (expected <digits>:<secret>)`);
      const v = await probeTelegram({ fetch: ctx.fetch }, token);
      if (v.state === "valid") return pass(v.detail);
      return v.state === "invalid" ? fail(`${v.detail}: replace the token (BotFather /token), then \`pnpm hub token telegram\``) : warn(`not verified: ${v.detail}`);
    },
  },
  {
    id: "messengers.poller", group: "Messengers", title: "The messengers poller is running inside the server",
    why: "The server starts the poller when the token file exists. A token with no running poller means messages are not arriving.",
    verifies: "`GET /api/health` on the local server reports `messengers.state` = `running` with a poll in the last 5 minutes. WARN when the server is down or the feature is off without a token.",
    async check(ctx) {
      const hasToken = existsSync(TOKEN(ctx.configDir));
      const h = await health(ctx.fetch);
      if (typeof h === "string") return warn(h);
      const m = h.messengers;
      if (!m) return warn("the server does not report messengers: restart it on the current version");
      if (m.state === "off") return hasToken ? warn(`token present but the poller is off: ${m.reason ?? "no reason given"}`) : pass("off (no token file)");
      if (m.state === "error") return fail(`poller error: ${m.lastError ?? "unknown"}`);
      if (m.state !== "running") return warn(`poller is ${m.state}`);
      if (!m.lastPollAt) return pass(`running for ${m.project}, first poll pending`);
      const age = Date.now() - Date.parse(m.lastPollAt);
      return age > STALE_MS ? warn(`running but the last poll was ${Math.round(age / 60000)} min ago`) : pass(`running for ${m.project}, last poll ${Math.max(0, Math.round(age / 1000))} s ago`);
    },
  },
  {
    id: "whatsapp.app", group: "Messengers", title: "The server can read the Mac's WhatsApp app (history refill, read only)",
    why: "WhatsApp keeps no history a linked device may read: the Hub refills a WhatsApp chat from the WhatsApp app's own database on this Mac (read only, one chat at a time, decision 0049). macOS may refuse the server's process, which runs under launchd, even when your Terminal can read the file; then history comes only from messages received while the Hub runs, and the cache keeps 90 days instead of 30.",
    verifies: "`GET /api/health` reports `whatsapp.appHistory` as the server's own process found it (this check does not open the file itself: your shell's access says nothing about the server's). PASS when it is on; WARN with the one fix when macOS refused it, when the app is not installed, or when its database changed; PASS when no WhatsApp number is connected.",
    manual: { steps: ["If macOS refused it: System Settings ▸ Privacy & Security ▸ Full Disk Access, add the node binary the row names, then `./run.sh restart`."] },
    async check(ctx) {
      const h = await health(ctx.fetch);
      if (typeof h === "string") return warn(h);
      const w = h.whatsapp;
      if (!w || w.state !== "on") return pass("no WhatsApp number is connected here");
      const a = w.appHistory;
      if (!a) return warn("the server does not report the WhatsApp app refill: restart it on the current version");
      if (a.state === "on") return pass(`the server reads the WhatsApp app's database (read only); the cache keeps ${a.cacheDays ?? 30} days`);
      return warn(`${a.detail ?? "the WhatsApp app's database is not read"}${a.fix ? ` Fix: ${a.fix}` : ""}`);
    },
  },
];
