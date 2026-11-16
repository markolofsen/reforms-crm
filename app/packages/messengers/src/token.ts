import { readFile } from "node:fs/promises";
import { secretsDir } from "@hub/mail/imap";
import { join } from "node:path";
import { MessengersError } from "./errors";

/** `<home>/state/secrets/telegram-bot-token` (git-ignored; `HUB_CONFIG_DIR` overrides). */
export const botTokenFile = (env: NodeJS.ProcessEnv = process.env): string => join(secretsDir(env), "telegram-bot-token");

const SHAPE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

/**
 * The messengers bot token: a NEW bot made for this app in BotFather. It must never be the token of a bot that already has a webhook:
 * that bot has a webhook, and a webhook and long polling exclude each other. The value is never logged or put in an error.
 */
export async function readBotToken(file: string = botTokenFile()): Promise<string> {
  let raw: string;
  try {
    raw = (await readFile(file, "utf8")).trim();
  } catch {
    throw new MessengersError("no_token", `no_token: put the bot token alone in ${file} (chmod 600). Create a new bot with @BotFather.`);
  }
  if (!SHAPE.test(raw)) throw new MessengersError("no_token", `no_token: ${file} does not hold a Telegram bot token (expected <digits>:<secret>)`);
  return raw;
}

/** The bot id is the part before the colon; it is public and identifies the account in the database. */
export const botIdOf = (token: string): string => token.split(":", 1)[0]!;
