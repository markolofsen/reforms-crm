import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * `projects/<slug>/watch.md` (P144, draft decision 0052): one project's watch list, project data the owner changes by a phrase to
 * the agent. A settings table and a list of groups:
 *
 * ```md
 * # Watch
 *
 * | Setting | Value |
 * |---|---|
 * | lens | watch-acme |
 * | on | no |
 * | account | default |
 * | poll_minutes | 5 |
 *
 * ## Groups
 *
 * - @some_public_group
 * ```
 *
 * `on` is off unless it says `yes`: a watch list starts switched off, so a restart never begins reading groups before the owner
 * says so. `account` is `default` (the project's connected Telegram user account) or the id of another connected account.
 */

export const WATCH_FILE = "watch.md";

/** A public username as Telegram allows it (5 to 32 letters, digits and `_`), written with or without `@`. */
const USERNAME = /^@?([A-Za-z][A-Za-z0-9_]{3,31})$/;

export interface WatchConfig {
  lens: string;
  on: boolean;
  /** `default`, or a connected account's id. */
  account: string;
  pollMinutes: number;
  /** Lower-case usernames, without `@`, in the file's order. */
  groups: string[];
}

export type WatchConfigRead = { state: "none" } | { state: "ok"; config: WatchConfig } | { state: "invalid"; reason: string };

const Settings = z.object({
  lens: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "a package folder name under packages/"),
  on: z.enum(["yes", "no"]).default("no"),
  account: z.string().regex(/^(default|[0-9]{3,20})$/, "default, or a connected account's id").default("default"),
  poll_minutes: z.coerce.number().int().min(5, "at least 5 minutes").max(1440).default(5),
});

/** The settings table's `| key | value |` rows (the header and separator skipped) and the `## Groups` list. Pure. */
export function parseWatch(text: string): WatchConfigRead {
  const settings: Record<string, string> = {};
  const groups: string[] = [];
  let section: "settings" | "groups" | "other" = "settings";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^##\s+/.test(line)) {
      section = /^##\s+groups\s*$/i.test(line) ? "groups" : "other";
      continue;
    }
    if (section === "settings") {
      const m = /^\|\s*([a-z_]+)\s*\|\s*([^|]*?)\s*\|$/.exec(line);
      if (m?.[1] && m[1] !== "setting") settings[m[1]] = m[2] ?? "";
    } else if (section === "groups") {
      const m = /^[-*]\s+(\S+)/.exec(line);
      if (!m?.[1]) continue;
      const u = USERNAME.exec(m[1]);
      if (!u?.[1]) return { state: "invalid", reason: `"${m[1]}" is not a public group username` };
      const name = u[1].toLowerCase();
      if (!groups.includes(name)) groups.push(name);
    }
  }
  if (groups.length > WATCH_GROUP_CAP) return { state: "invalid", reason: `${groups.length} groups listed; a watch list holds at most ${WATCH_GROUP_CAP} (the account's 20 username resolves a day carry that many)` };
  const r = Settings.safeParse(settings);
  if (!r.success) return { state: "invalid", reason: r.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`).join("; ") };
  return { state: "ok", config: { lens: r.data.lens, on: r.data.on === "yes", account: r.data.account, pollMinutes: r.data.poll_minutes, groups } };
}

/** The most groups one watch list may name (P153 D4): what one account's resolve budget carries with room for a re-resolve. */
export const WATCH_GROUP_CAP = 15;

/** The project's watch list, or `none` when it has no `watch.md`. */
export function readWatch(projectDir: string): WatchConfigRead {
  const file = join(projectDir, WATCH_FILE);
  if (!existsSync(file)) return { state: "none" };
  try {
    return parseWatch(readFileSync(file, "utf8"));
  } catch (e) {
    return { state: "invalid", reason: e instanceof Error ? e.message.slice(0, 200) : "unreadable" };
  }
}
