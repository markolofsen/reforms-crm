import { join } from "node:path";
import { createNotionReader, loadToken, secretsDir, type NotionReader } from "@hub/notion";
import { createChatClientWriter, searchClientPages, type ChatClientWriter } from "@hub/notion/chat-client";
import { buildDirectory, e164, telegramUsername, type DialogChannel, type Directory, type DirectoryEntry, type DirectoryKey } from "@hub/messengers";
import { ops } from "@hub/log/ops";

/**
 * The client directory of the autolink (P84, decision 0036 point 3 and 0009 as amended 2026-11-20): the project's Notion Clients
 * data source, read (the instance's Notion token, the reader of `@hub/notion`, which has no write method) at start and every
 * 6 hours, and kept in memory. P100: the link box also asks Notion live (`search`, read only) and puts what it finds into memory;
 * `notion()` hands the routes the chat writer of `@hub/notion/chat-client` for the owner's Create and the fill-back on Link. Nothing of it is written to `app.db` or to a file: a `clients` row is made only when a chat is linked.
 * Rows marked `Synthetic` (the mail chain check's test records) or `Do not contact` are left out. Identifiers (the pack's Clients
 * fields, `schema/clients.json`): `Phone` (or any other `phone_number` property, or one named Mobile or Tel) counts for both
 * messengers; `WhatsApp` for WhatsApp chats only; `Telegram` holds a username (`anna_k`, `@anna_k` or a `t.me/` link) or a number,
 * for Telegram chats only. A number without a country code is not guessed into one.
 */

export const DIRECTORY_REFRESH_MS = 6 * 60 * 60 * 1000;
/** P143 N2: one card is read again at most this often (a conversation opened, its Refresh, a Hub write to the card). */
export const CARD_READ_MS = 60_000;
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
  /**
   * P100: the link box's live search: one read-only query of the Notion Clients data source (name, email, Other emails, phone,
   * WhatsApp, Telegram contain the term); the records found are put into memory (so Link finds them and the autolink matches them).
   */
  search(q: string): Promise<{ entries: DirectoryEntry[]; error: string | null }>;
  /** P100: one record into memory now (a live hit, or a card the owner just created), the index rebuilt. */
  put(entry: DirectoryEntry): void;
  /**
   * P143 N2: reads ONE card now (a page read, read only) and hands it to the same read-back as the full read (`onRead`), so a
   * title the agent or the owner wrote in Notion directly names the Hub's client when its conversation opens, not 6 hours later.
   * At most once per `CARD_READ_MS` per card unless `force` (after a Hub write to it); never throws; resolves when done.
   */
  readCard(pageId: string, o?: { force?: boolean }): Promise<void>;
  /** The clients data source id, or null. */
  dataSourceId: string | null;
  /** P100: the reader and the chat writer, built from the instance token (fakes in tests). */
  notion(): Promise<{ reader: NotionReader; writer: ChatClientWriter }>;
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
  /** Tests pass a fake chat writer (P100); default: the real one, built from the token. */
  writer?: ChatClientWriter;
  refreshMs?: number;
  now?: () => Date;
  /** false: no first read and no timer (tests call `refresh`). */
  auto?: boolean;
  /** P140 P1b: told every full read's records, so the Hub's own client names follow a better Notion title. Its failure is logged, never thrown. */
  onRead?: (entries: readonly DirectoryEntry[]) => Promise<unknown>;
}

export function startClientDirectory(o: StartDirectory): ClientDirectory {
  const env = o.env ?? process.env;
  const now = o.now ?? (() => new Date());
  let dir: Directory | null = null;
  let st: DirectoryStatus = { state: "off", reason: o.dataSourceId ? "not read yet" : "no clients database in project.md", entries: 0, withIdentifier: 0, byRelationship: {}, readAt: null };
  let running: Promise<void> | null = null;

  /** Records put in since the last full read began: kept when that read did not list them yet (a page made during the read). */
  const extra = new Map<string, DirectoryEntry>();
  const token = () => loadToken(o.tokenFile === "notion-token" ? env : { ...env, NOTION_TOKEN: "" }, join(secretsDir(env), o.tokenFile));
  const why = (e: unknown) => (e instanceof Error && e.name === "NoTokenError" ? "no Notion token" : `Notion read failed (${e instanceof Error ? e.name : "error"})`);

  const read = async () => {
    if (!o.dataSourceId) return;
    st = { ...st, state: dir ? "ready" : "loading" };
    const began = new Set(extra.keys());
    try {
      const reader = o.reader ?? createNotionReader(await token());
      const entries: DirectoryEntry[] = [];
      for await (const page of reader.listPages(o.dataSourceId)) {
        const e = entryOf(page as { id: string; properties: Record<string, Prop> });
        if (e) entries.push(e);
      }
      const listed = new Set(entries.map((e) => e.key));
      for (const [k, e] of extra) if (!listed.has(k)) entries.push(e);
      for (const k of began) extra.delete(k);
      const byRelationship: Record<string, number> = {};
      for (const e of entries) if (e.identifiers.length) byRelationship[e.relationship ?? "none"] = (byRelationship[e.relationship ?? "none"] ?? 0) + 1;
      dir = buildDirectory(entries);
      st = { state: "ready", reason: null, entries: entries.length, withIdentifier: entries.filter((e) => e.identifiers.length > 0).length, byRelationship, readAt: now().toISOString() };
      await o.onRead?.(entries).catch((e: unknown) => ops("notion").warn("taking the client names from Notion failed", { kind: e instanceof Error ? e.name : "error" }));
    } catch (e) {
      // The message names the failure's class only: a Notion error can quote a property value.
      st = { ...st, state: dir ? "ready" : "error", reason: why(e) };
      ops("notion").error("reading the Notion clients for the autolink failed", { reason: why(e), kept: dir ? "the last read" : "nothing" });
    }
  };
  const refresh = () => (running ??= read().finally(() => (running = null)));

  const timer = o.auto === false || !o.dataSourceId ? null : setInterval(() => void refresh(), o.refreshMs ?? DIRECTORY_REFRESH_MS);
  timer?.unref?.();
  if (o.auto !== false) void refresh();

  const put = (entry: DirectoryEntry) => {
    extra.set(entry.key, entry);
    const rest = (dir?.all ?? []).filter((e) => e.key !== entry.key);
    dir = buildDirectory([...rest, entry]);
  };
  /** When each card was last read one by one, so an open conversation's re-renders do not each ask Notion. */
  const cardReadAt = new Map<string, number>();
  const readCard = async (pageId: string, ro: { force?: boolean } = {}): Promise<void> => {
    if (!o.dataSourceId || !pageId) return;
    const t = now().getTime();
    const last = cardReadAt.get(pageId);
    if (!ro.force && last !== undefined && t - last < CARD_READ_MS) return;
    cardReadAt.set(pageId, t);
    try {
      const { writer } = await notion();
      const e = entryOf((await writer.retrievePage(pageId)) as { id: string; properties: Record<string, Prop> });
      if (!e) return;
      put(e);
      await o.onRead?.([e]);
    } catch (e) {
      ops("notion").warn("reading one client card from Notion failed", { reason: why(e) });
    }
  };
  // An injected reader means a test: the writer is then the injected one or none at all, never a real one from a token on disk.
  const noWriter = (): ChatClientWriter => {
    const refuse = async (): Promise<never> => {
      throw new Error("no Notion writer in this setup");
    };
    return { createClient: refuse, retrievePage: refuse, fillEmpty: refuse };
  };
  const notion = async () => {
    if (o.reader) return { reader: o.reader, writer: o.writer ?? noWriter() };
    const t = await token();
    return { reader: createNotionReader(t), writer: o.writer ?? createChatClientWriter(t) };
  };

  return {
    status: () => ({ ...st, byRelationship: { ...st.byRelationship } }),
    current: () => dir,
    refresh,
    put,
    readCard,
    dataSourceId: o.dataSourceId,
    notion,
    async search(q) {
      if (!o.dataSourceId) return { entries: [], error: "no clients database in project.md" };
      try {
        const { reader } = await notion();
        const pages = await searchClientPages(reader, o.dataSourceId, q);
        const entries = pages.map((p) => entryOf(p as { id: string; properties: Record<string, Prop> })).filter((e): e is DirectoryEntry => e !== null);
        for (const e of entries) put(e);
        return { entries, error: null };
      } catch (e) {
        ops("notion").warn("the live search of the Notion clients failed", { reason: why(e) });
        return { entries: [], error: why(e) };
      }
    },
    stop: () => {
      if (timer) clearInterval(timer);
    },
  };
}
