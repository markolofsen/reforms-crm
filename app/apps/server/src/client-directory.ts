import { join } from "node:path";
import { createNotionReader, loadToken, secretsDir, type NotionReader } from "@hub/notion";
import { buildDirectory, e164, telegramUsername, type DialogChannel, type Directory, type DirectoryEntry, type DirectoryKey } from "@hub/messengers";

/**
 * The client directory of the autolink (P84, decision 0036 point 3 and 0009 as amended 2026-11-20): the project's Notion Clients
 * data source, read ONLY (the instance's Notion token, the reader of `@hub/notion`, which has no write method), at start and every
 * 6 hours, and kept in memory. Nothing of it is written to `app.db` or to a file: a `clients` row is made only when a chat is linked.
 * Rows marked `Synthetic` (the mail chain check's test records) or `Do not contact` are left out. Identifiers (the pack's Clients
 * fields, `schema/clients.json`): `Phone` (or any other `phone_number` property, or one named Mobile or Tel) counts for both
 * messengers; `WhatsApp` for WhatsApp chats only; `Telegram` holds a username (`anna_k`, `@anna_k` or a `t.me/` link) or a number,
 * for Telegram chats only. A number without a country code is not guessed into one.
 */

export const DIRECTORY_REFRESH_MS = 6 * 60 * 60 * 1000;
const NUMBER_PROPS = /^(phone|mobile|tel)$/i;
/** A property of one messenger: its numbers match that messenger's chats only. */
const channelOf = (key: string): DialogChannel | null => (/^whatsapp$/i.test(key) ? "whatsapp" : /^telegram$/i.test(key) ? "telegram" : null);

export interface DirectoryStatus {
  state: "off" | "loading" | "ready" | "error";
  reason: string | null;
  /** Records read (after the exclusions), and how many carry an identifier. */
  entries: number;
  withIdentifier: number;
  /** Records with an identifier by Relationship (Client, Prospect, Lead, ...), for the owner's view and the dry run. */
  byRelationship: Record<string, number>;
  readAt: string | null;
}

export interface ClientDirectory {
  status(): DirectoryStatus;
  /** The index, or null while none is loaded. */
  current(): Directory | null;
  refresh(): Promise<void>;
  stop(): void;
}

type Prop = { type?: unknown; [k: string]: unknown };
const textOf = (p: Prop | undefined): string => {
  if (!p) return "";
  const t = p.type;
  if (t === "phone_number" || t === "email" || t === "url") return typeof p[t] === "string" ? (p[t] as string) : "";
  if (t === "title" || t === "rich_text") {
    const parts = p[t];
    return Array.isArray(parts) ? parts.map((x: { plain_text?: unknown }) => (typeof x?.plain_text === "string" ? x.plain_text : "")).join("") : "";
  }
  if (t === "select") {
    const s = p.select as { name?: unknown } | null;
    return typeof s?.name === "string" ? s.name : "";
  }
  return "";
};
const checked = (p: Prop | undefined) => p?.type === "checkbox" && p.checkbox === true;

/** One Notion page to a directory entry, or null when it is excluded. Pure (tests feed page objects). */
export function entryOf(page: { id: string; properties: Record<string, Prop> }): DirectoryEntry | null {
  const props = page.properties;
  if (checked(props["Synthetic"]) || checked(props["Do not contact"])) return null;
  const ids: DirectoryKey[] = [];
  let name = "";
  let email: string | null = null;
  for (const [key, p] of Object.entries(props)) {
    if (p.type === "title") name = textOf(p).trim();
    if (p.type === "email" && !email) email = textOf(p).trim().toLowerCase() || null;
    const channel = channelOf(key);
    if (p.type !== "phone_number" && !NUMBER_PROPS.test(key) && !channel) continue;
    // A field may hold several values separated by a comma, a semicolon or a slash (not inside a t.me link).
    for (const part of textOf(p).split(/[,;]|\s\/\s|\/(?=\s*(?:\+|00))/)) {
      const n = e164(part);
      if (n) {
        if (!ids.some((i) => i.kind === "phone" && i.value === n && i.channel === (channel ?? undefined))) ids.push(channel ? { kind: "phone", value: n, channel } : { kind: "phone", value: n });
        continue;
      }
      const u = channel === "telegram" ? telegramUsername(part) : null;
      if (u && !ids.some((i) => i.kind === "username" && i.value === u)) ids.push({ kind: "username", value: u });
    }
  }
  return { key: page.id, name, email, relationship: textOf(props["Relationship"]).trim() || null, identifiers: ids };
}

export interface StartDirectory {
  /** The project's clients data source id (project.md `## Notion databases`, slug `clients`), or null. */
  dataSourceId: string | null;
  tokenFile: string;
  env?: NodeJS.ProcessEnv;
  /** Tests pass a fake reader; default: the real one, built from the token. */
  reader?: NotionReader;
  refreshMs?: number;
  now?: () => Date;
  /** false: no first read and no timer (tests call `refresh`). */
  auto?: boolean;
}

export function startClientDirectory(o: StartDirectory): ClientDirectory {
  const env = o.env ?? process.env;
  const now = o.now ?? (() => new Date());
  let dir: Directory | null = null;
  let st: DirectoryStatus = { state: "off", reason: o.dataSourceId ? "not read yet" : "no clients database in project.md", entries: 0, withIdentifier: 0, byRelationship: {}, readAt: null };
  let running: Promise<void> | null = null;

  const read = async () => {
    if (!o.dataSourceId) return;
    st = { ...st, state: dir ? "ready" : "loading" };
    try {
      const reader = o.reader ?? createNotionReader(await loadToken(o.tokenFile === "notion-token" ? env : { ...env, NOTION_TOKEN: "" }, join(secretsDir(env), o.tokenFile)));
      const entries: DirectoryEntry[] = [];
      for await (const page of reader.listPages(o.dataSourceId)) {
        const e = entryOf(page as { id: string; properties: Record<string, Prop> });
        if (e) entries.push(e);
      }
      const byRelationship: Record<string, number> = {};
      for (const e of entries) if (e.identifiers.length) byRelationship[e.relationship ?? "none"] = (byRelationship[e.relationship ?? "none"] ?? 0) + 1;
      dir = buildDirectory(entries);
      st = { state: "ready", reason: null, entries: entries.length, withIdentifier: entries.filter((e) => e.identifiers.length > 0).length, byRelationship, readAt: now().toISOString() };
    } catch (e) {
      // The message names the failure's class only: a Notion error can quote a property value.
      const why = e instanceof Error && e.name === "NoTokenError" ? "no Notion token" : `Notion read failed (${e instanceof Error ? e.name : "error"})`;
      st = { ...st, state: dir ? "ready" : "error", reason: why };
    }
  };
  const refresh = () => (running ??= read().finally(() => (running = null)));

  const timer = o.auto === false || !o.dataSourceId ? null : setInterval(() => void refresh(), o.refreshMs ?? DIRECTORY_REFRESH_MS);
  timer?.unref?.();
  if (o.auto !== false) void refresh();

  return {
    status: () => ({ ...st, byRelationship: { ...st.byRelationship } }),
    current: () => dir,
    refresh,
    stop: () => {
      if (timer) clearInterval(timer);
    },
  };
}
