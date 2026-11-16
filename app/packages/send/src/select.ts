import type { Mailer } from "./mailer.js";

/**
 * Which Mailer a long-running process (the server) uses, decided once at start from the environment.
 *
 * - `HUB_MAILER` unset: the real one, Mail.app through osascript.
 * - `HUB_MAILER=fake`: a fake that never leaves the process. It is for the e2e run and demos only, so it is refused
 *   unless `HUB_DB` also names a database (the default path is the live one) and nothing else spells it: `1`, `true`,
 *   `FAKE` or a typo is an error, never a silent fall back to the real Mailer or to the fake.
 *
 * Only the server reads this. `hub send` on the command line always uses the real Mailer.
 */
export type MailerKind = "mail-app" | "fake";

export function chooseMailerKind(env: { HUB_MAILER?: string | undefined; HUB_DB?: string | undefined }): MailerKind {
  const v = env.HUB_MAILER;
  if (v === undefined || v === "") return "mail-app";
  if (v !== "fake") throw new Error(`HUB_MAILER must be unset or exactly "fake", got "${v}"`);
  if (!env.HUB_DB || env.HUB_DB === ":memory:") throw new Error('HUB_MAILER=fake needs HUB_DB set to a throwaway database file: the default database is the live one');
  return "fake";
}
