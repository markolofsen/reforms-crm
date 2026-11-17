import { existsSync, readFileSync, statSync } from "node:fs";
import { isTelegramToken, TELEGRAM_FILE } from "@hub/connections";
import path from "node:path";
import type { Step } from "../types.ts";
import { fail, pass, warn } from "./helpers.ts";

const TOKEN = (configDir: string) => path.join(configDir, TELEGRAM_FILE);
const HEALTH = `http://127.0.0.1:${process.env.HUB_PORT ?? "4317"}/api/health`;
const STALE_MS = 5 * 60_000;

interface Health { ok?: boolean; messengers?: { state?: string; reason?: string; project?: string; lastPollAt?: string; lastError?: string } }

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
    id: "messengers.poller", group: "Messengers", title: "The messengers poller is running inside the server",
    why: "The server starts the poller when the token file exists. A token with no running poller means messages are not arriving.",
    verifies: "`GET /api/health` on the local server reports `messengers.state` = `running` with a poll in the last 5 minutes. WARN when the server is down or the feature is off without a token.",
    async check(ctx) {
      const hasToken = existsSync(TOKEN(ctx.configDir));
      let h: Health;
      try {
        const r = await ctx.fetch(HEALTH, { signal: AbortSignal.timeout(4000) });
        if (!r.ok) return warn(`server answered ${r.status}`);
        h = (await r.json()) as Health;
      } catch {
        return warn("the local server is not running (start it with `pnpm --filter @hub/server start`)");
      }
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
];
