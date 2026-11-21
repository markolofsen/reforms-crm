import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { UNLINKED_FRESH_DAYS } from "@hub/config/chat-rules";
import type { Repos } from "@hub/db";
import { matchDialog, MATCH_REASON, type DialogChannel, type DialogIdentity, type DirectoryEntry } from "@hub/messengers";
import { autoLinkUserChat, type LinkableAdapter } from "@hub/messengers/human";
import type { UserDialog } from "@hub/messengers";
import type { ClientDirectory } from "./client-directory";
import { errFields, ops } from "@hub/log/ops";

/**
 * The autolink coordinator (P84, decision 0036 point 3 as amended 2026-11-20 on the owner's delegated word). The adapters tell it the
 * identity of each private chat they see that is not linked (chat id, name, phone, username: never a text), and Telegram's dialog
 * list once an account connects. For each it asks the client directory (Notion, in memory): exactly one record with an email and
 * `messengers.autolink on` links the chat (the client row, the identifier, the allow-list, 30 days imported) and writes one Activity
 * line; anything else (two or more records, no email, autolink off, no match) stays in memory only, for the Chats screen. A chat the
 * owner refused ("never link") is skipped by an HMAC of it, keyed by `state/secrets/autolink-key`. Nothing here sends; nothing of an
 * unlinked chat is written to `app.db` or a log.
 */

export type UserChannel = "telegram_user" | "whatsapp";
/** The matcher's name for each account kind: a record's WhatsApp number counts for WhatsApp chats only, its Telegram field for Telegram's. */
const MATCH_CHANNEL: Record<UserChannel, DialogChannel> = { telegram_user: "telegram", whatsapp: "whatsapp" };
export const CHANNEL_WORD: Record<UserChannel, string> = { telegram_user: "Telegram", whatsapp: "WhatsApp" };
/** Telegram's connect scan reads at most this many dialogs (the same bound as the warm-up of `connect`). */
export const SCAN_DIALOGS = 500;
/** The recent unlinked dialogs kept in memory for the Chats screen, newest first. */
export const RECENT_MAX = 200;

export type AutolinkAdapter = LinkableAdapter & { dialogs(limit: number): Promise<UserDialog[]> };

export interface Candidate {
  key: string;
  name: string;
  email: string | null;
  relationship: string | null;
}

/** An unlinked dialog the Hub saw, in memory only: why it was not linked, and the records it matched (a suggestion). */
export interface RecentDialog {
  channel: UserChannel;
  account: string;
  chatId: string;
  title: string;
  seenAt: string;
  /** `none`: no record matched; `ambiguous`: two or more; `no_email`: one, without an email; `off`: one, autolink is off; `failed`: the link was refused. */
  why: "none" | "ambiguous" | "no_email" | "off" | "failed";
  by: "phone" | "username" | null;
  candidates: Candidate[];
  /** P84c: the newest message's time and side (never its text): a message seen live, or the dialog list's; null when unknown. */
  last: LastMessage | null;
  /** P100: the chat's identity as the messenger gives it (memory only): prefilled into Create, written to an empty Notion field on Link. */
  username: string | null;
  phone: string | null;
}

export interface LastMessage {
  at: string;
  inbound: boolean;
}

/** P84c: a chat the owner hid ("not a client"), in memory only: its name for the Hidden view and its identity for Unhide. */
export interface HiddenDialog {
  channel: UserChannel;
  account: string | null;
  identity: DialogIdentity | null;
  chatId: string;
  title: string;
  hiddenAt: string;
  last: LastMessage | null;
}

export interface AutolinkState {
  project: string | null;
  enabled: boolean;
  /** Only the fresh ones (P84c): the newest message at most `freshDays` old. */
  recent: RecentDialog[];
  /** P102: every unlinked dialog the memory holds, of any age (up to `RECENT_MAX`), newest first; a superset of `recent`. */
  unlinked: RecentDialog[];
  /** Distinct unlinked chats that wrote since the server started: a number in memory, never stored (0036 point 3 as amended). */
  unlinkedActive: number;
  freshDays: number;
  /** P84c: the hidden chats the memory can name, newest first, and how many more refusals it cannot name (a fingerprint only). */
  hidden: HiddenDialog[];
  hiddenUnnamed: number;
}

export interface PreviewCounts {
  channel: UserChannel;
  account: string;
  dialogs: number;
  linked: number;
  unique: number;
  ambiguous: number;
  noEmail: number;
  /** The unique matches by the record's Relationship. */
  byRelationship: Record<string, number>;
}

export interface Autolink {
  /** An adapter's hook: one unlinked chat was seen (identity only). Never throws. */
  seen(channel: UserChannel, account: string, d: DialogIdentity, inbound: boolean): void;
  /** Telegram's connect scan: the account's dialogs, each considered. */
  scan(channel: UserChannel, account: string): Promise<void>;
  state(): Promise<AutolinkState>;
  /** The dry run: counts only, from the live accounts' dialog lists and the directory; writes nothing, reads no text. */
  preview(): Promise<PreviewCounts[]>;
  /** "Never link this chat" / Hide ("not a client", P84c): its HMAC is stored; the caller unlinks a linked one. `title` names it in Hidden. */
  refuse(channel: UserChannel, chatId: string, title?: string | null): Promise<void>;
  /** Unhide (P84c): the refusal is deleted and the chat, when its identity is in memory, is considered again. Returns whether one went. */
  unrefuse(channel: UserChannel, chatId: string): Promise<boolean>;
  /** P102: a manual Link of a hidden chat takes its refusal back in the same call (the HMAC row and the name in Hidden); the matcher is not re-run. */
  forget(channel: UserChannel, chatId: string): Promise<void>;
  /** A directory record by its key, for the owner's Link from the Chats screen. */
  record(key: string): DirectoryEntry | null;
  /**
   * P100: up to 8 records for the link box: those in memory whose name, email, Telegram username or phone holds `q` (two or more
   * characters; `@` and a number's spacing ignored), then a live Notion query for the same term, merged by page id.
   */
  findRecords(q: string): Promise<{ records: Candidate[]; live: boolean; liveError: string | null }>;
  /** P100: the identity of an unlinked or hidden chat the memory knows (username, phone), for Create and the fill on Link. */
  identityOf(channel: UserChannel, chatId: string): { username: string | null; phone: string | null } | null;
  /** The live adapter of a connected account (the owner's Link reads through it). */
  adapterOf(channel: UserChannel, account: string): AutolinkAdapter | undefined;
  /** Waits for the links in flight (tests). */
  idle(): Promise<void>;
}

export interface StartAutolink {
  repos: Repos;
  project: string | null;
  directory: ClientDirectory;
  /** The project's `messengers.autolink`, read fresh (project.md), so a change applies without a restart. */
  enabled: () => Promise<boolean>;
  /** The live adapter of a connected account, or undefined. */
  adapterOf: (channel: UserChannel, account: string) => AutolinkAdapter | undefined;
  /** The live accounts of each channel (for the dry run). */
  accounts: () => { channel: UserChannel; account: string }[];
  /** The HMAC key's file, made on first use (0600). */
  keyFile: string;
  now?: () => Date;
}

const candidateOf = (e: DirectoryEntry): Candidate => ({ key: e.key, name: e.name, email: e.email, relationship: e.relationship });
export const FIND_MAX = 8;

/** P100: whether a record holds the term in its name, email or an identifier. `@` and a number's spacing do not count. Pure. */
export function recordMatches(e: DirectoryEntry, q: string): boolean {
  const text = q.trim().replace(/^@/, "").toLowerCase();
  if (text.length < 2) return false;
  const digits = text.replace(/[\s\-().+]/g, "");
  const number = /^\d{5,15}$/.test(digits) ? digits : null;
  if (e.name.toLowerCase().includes(text) || (e.email ?? "").includes(text)) return true;
  return e.identifiers.some((i) => (i.kind === "username" ? i.value.includes(text) : number !== null && i.value.replace(/\D/g, "").includes(number)));
}

/** The key of "never link": 32 random bytes, hex, in a 0600 file under state/secrets. Not in the backup: a new key forgets refusals. */
function keyOf(file: string): string {
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const k = randomBytes(32).toString("hex");
  writeFileSync(file, `${k}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(file, 0o600);
  return k;
}

export function startAutolink(o: StartAutolink): Autolink {
  const now = o.now ?? (() => new Date());
  const recent = new Map<string, RecentDialog>();
  const hidden = new Map<string, HiddenDialog>();
  const active = new Set<string>();
  const inflight = new Map<string, Promise<void>>();
  let refused: Set<string> | null = null;
  let key: string | null = null;

  const hmac = (channel: UserChannel, chatId: string) => createHmac("sha256", (key ??= keyOf(o.keyFile))).update(`${o.project}\n${channel}\n${chatId}`).digest("hex");
  const refusals = async () => (refused ??= new Set(o.project ? (await o.repos.messengers.linkRefusals(o.project)).map((r) => `${r.channel}:${r.hash}`) : []));
  const isRefused = async (channel: UserChannel, chatId: string) => (await refusals()).has(`${channel}:${hmac(channel, chatId)}`);

  const newer = (a: LastMessage | null | undefined, b: LastMessage | null | undefined): LastMessage | null => (!a ? (b ?? null) : !b ? a : a.at >= b.at ? a : b);
  const remember = (r: RecentDialog) => {
    const k = `${r.channel}:${r.chatId}`;
    const was = recent.get(k);
    recent.delete(k);
    recent.set(k, { ...r, last: newer(r.last, was?.last) });
    while (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value ?? "");
  };

  async function activity(project: string, clientId: number, name: string, channel: UserChannel, reason: string, imported: number) {
    const at = now().toISOString();
    const runId = await o.repos.runs.start({ project, startedAt: at, finishedAt: at, trigger: "autolink", skill: null, status: "ok" });
    const why = `${CHANNEL_WORD[channel]} chat, ${reason}; ${imported} ${imported === 1 ? "message" : "messages"} of the last 30 days imported. Next: say "triage messages for ${name}".`;
    await o.repos.runs.addEvent({ project, runId, at, kind: "decision", tool: null, summary: `Linked ${name}'s ${CHANNEL_WORD[channel]} chat: ${name}`, detail: JSON.stringify({ action: "linked", reason: why, channel }), clientId });
  }

  /** P84c: a refused chat the Hub sees again is named in Hidden (memory only), so the view refills after a restart. */
  const keepHidden = (channel: UserChannel, account: string | null, chatId: string, title: string, identity: DialogIdentity | null, last: LastMessage | null) => {
    const k = `${channel}:${chatId}`;
    const was = hidden.get(k);
    hidden.delete(k);
    hidden.set(k, { channel, account: account ?? was?.account ?? null, identity: identity ?? was?.identity ?? null, chatId, title: title || was?.title || chatId, hiddenAt: was?.hiddenAt ?? now().toISOString(), last: newer(last, was?.last) });
    while (hidden.size > RECENT_MAX) hidden.delete(hidden.keys().next().value ?? "");
  };

  async function consider(channel: UserChannel, account: string, d: DialogIdentity, last: LastMessage | null = null): Promise<void> {
    const project = o.project;
    if (!project) return;
    if (await o.repos.messengers.isAllowed(project, channel, d.chatId)) {
      recent.delete(`${channel}:${d.chatId}`);
      return;
    }
    if (await isRefused(channel, d.chatId)) return keepHidden(channel, account, d.chatId, d.title, d, last);
    const base = { channel, account, chatId: d.chatId, title: d.title, seenAt: now().toISOString(), last, username: d.username ?? null, phone: d.phone ?? null };
    const dir = o.directory.current();
    const m = dir ? matchDialog(dir, d, MATCH_CHANNEL[channel]) : ({ kind: "none" } as const);
    if (m.kind === "none") return remember({ ...base, why: "none", by: null, candidates: [] });
    if (m.kind === "ambiguous") return remember({ ...base, why: "ambiguous", by: m.by, candidates: m.entries.map(candidateOf) });
    if (m.kind === "no_email") return remember({ ...base, why: "no_email", by: m.by, candidates: [candidateOf(m.entry)] });
    if (!(await o.enabled())) return remember({ ...base, why: "off", by: m.by, candidates: [candidateOf(m.entry)] });
    const adapter = o.adapterOf(channel, account);
    if (!adapter) return remember({ ...base, why: "off", by: m.by, candidates: [candidateOf(m.entry)] });
    const reason = MATCH_REASON[m.by];
    try {
      const r = await autoLinkUserChat({ repos: o.repos, adapter, now }, { project, client: { email: m.entry.email ?? "", name: m.entry.name }, chatId: d.chatId, reason, title: d.title });
      recent.delete(`${channel}:${d.chatId}`);
      await activity(project, r.clientId, m.entry.name || (m.entry.email ?? d.title), channel, reason, r.imported);
    } catch {
      // A duplicate identifier (the number is already another client's) or a refused write: shown, never retried by itself.
      remember({ ...base, why: "failed", by: m.by, candidates: [candidateOf(m.entry)] });
    }
  }

  const run = (channel: UserChannel, account: string, d: DialogIdentity, last: LastMessage | null = null) => {
    const k = `${channel}:${d.chatId}`;
    if (inflight.has(k)) return inflight.get(k)!;
    const p = consider(channel, account, d, last)
      .catch((e: unknown) => ops("autolink").warn("matching a chat to a client failed", { channel, account, ...errFields(e) }))
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  };

  return {
    seen(channel, account, d, inbound) {
      if (inbound) active.add(`${channel}:${d.chatId}`);
      void run(channel, account, d, { at: now().toISOString(), inbound });
    },
    async scan(channel, account) {
      const adapter = o.adapterOf(channel, account);
      if (!adapter || !o.project) return;
      const ds = await adapter.dialogs(SCAN_DIALOGS).catch((e: unknown) => {
        ops("autolink").warn("reading the dialogs for a scan failed", { channel, account, ...errFields(e) });
        return [] as UserDialog[];
      });
      // Oldest first, so the newest dialog is remembered last and shows first on Chats.
      for (const d of [...ds].reverse()) await run(channel, account, d, d.last ?? null);
    },
    async state() {
      const enabled = o.project ? await o.enabled() : false;
      // A chat linked since it was remembered (by the owner or a later match) leaves the list.
      const rows = [...recent.values()].reverse();
      const unlinked: RecentDialog[] = [];
      for (const r of rows) if (o.project && !(await o.repos.messengers.isAllowed(o.project, r.channel, r.chatId))) unlinked.push(r);
      // P84c: To do holds only the fresh ones (the newest message at most `freshDays` old); P102: Not linked holds every one.
      const since = now().getTime() - UNLINKED_FRESH_DAYS * 86_400_000;
      const live = unlinked.filter((r) => r.last !== null && Date.parse(r.last.at) >= since);
      const named = [...hidden.values()].reverse();
      const total = o.project ? (await refusals()).size : 0;
      return { project: o.project, enabled, recent: live, unlinked, unlinkedActive: active.size, freshDays: UNLINKED_FRESH_DAYS, hidden: named, hiddenUnnamed: Math.max(0, total - named.length) };
    },
    async preview() {
      const out: PreviewCounts[] = [];
      const dir = o.directory.current();
      for (const { channel, account } of o.accounts()) {
        const adapter = o.adapterOf(channel, account);
        if (!adapter) continue;
        const ds = await adapter.dialogs(channel === "whatsapp" ? 2000 : SCAN_DIALOGS).catch((e: unknown) => {
          ops("autolink").warn("reading the dialogs for a preview failed", { channel, account, ...errFields(e) });
          return [] as UserDialog[];
        });
        const c: PreviewCounts = { channel, account, dialogs: ds.length, linked: 0, unique: 0, ambiguous: 0, noEmail: 0, byRelationship: {} };
        for (const d of ds) {
          if (o.project && (await o.repos.messengers.isAllowed(o.project, channel, d.chatId))) {
            c.linked++;
            continue;
          }
          const m = dir ? matchDialog(dir, d, MATCH_CHANNEL[channel]) : ({ kind: "none" } as const);
          if (m.kind === "unique") {
            c.unique++;
            const rel = m.entry.relationship ?? "none";
            c.byRelationship[rel] = (c.byRelationship[rel] ?? 0) + 1;
          } else if (m.kind === "ambiguous") c.ambiguous++;
          else if (m.kind === "no_email") c.noEmail++;
        }
        out.push(c);
      }
      return out;
    },
    async refuse(channel, chatId, title) {
      if (!o.project) return;
      const h = hmac(channel, chatId);
      await o.repos.messengers.refuseLink(o.project, channel, h);
      (await refusals()).add(`${channel}:${h}`);
      const r = recent.get(`${channel}:${chatId}`);
      recent.delete(`${channel}:${chatId}`);
      // A linked chat hidden by Never link has no remembered account: with exactly one account on the channel, it is that one (Link on Hidden needs it).
      const sole = o.accounts().filter((a) => a.channel === channel);
      keepHidden(channel, r?.account ?? (sole.length === 1 ? (sole[0]?.account ?? null) : null), chatId, title ?? r?.title ?? chatId, null, r?.last ?? null);
    },
    async forget(channel, chatId) {
      if (!o.project) return;
      const h = hmac(channel, chatId);
      await o.repos.messengers.forgetLinkRefusal(o.project, channel, h);
      (await refusals()).delete(`${channel}:${h}`);
      hidden.delete(`${channel}:${chatId}`);
    },
    async unrefuse(channel, chatId) {
      if (!o.project) return false;
      const h = hmac(channel, chatId);
      const gone = await o.repos.messengers.forgetLinkRefusal(o.project, channel, h);
      (await refusals()).delete(`${channel}:${h}`);
      const k = `${channel}:${chatId}`;
      const was = hidden.get(k);
      hidden.delete(k);
      // Back on Chats at once when the memory knows who it is; a linked chat hidden by Never link comes back when it writes again.
      if (was?.account) await run(channel, was.account, was.identity ?? { chatId, title: was.title, phone: channel === "whatsapp" ? chatId : null, username: null }, was.last);
      return gone || was !== undefined;
    },
    record(k) {
      const dir = o.directory.current();
      if (!dir) return null;
      return dir.all.find((e) => e.key === k) ?? null;
    },
    async findRecords(q) {
      if (q.trim().replace(/^@/, "").length < 2) return { records: [], live: false, liveError: null };
      const local = (o.directory.current()?.all ?? []).filter((e) => e.email && recordMatches(e, q));
      // Always Notion too: a page made a minute ago is not in the copy read at start and every 6 h (P100).
      const live = await o.directory.search(q);
      const seen = new Set<string>();
      const records: Candidate[] = [];
      for (const e of [...local, ...live.entries.filter((x) => x.email)]) {
        if (seen.has(e.key)) continue;
        seen.add(e.key);
        records.push(candidateOf(e));
      }
      return { records: records.slice(0, FIND_MAX), live: live.error === null, liveError: live.error };
    },
    identityOf(channel, chatId) {
      const r = recent.get(`${channel}:${chatId}`);
      if (r) return { username: r.username, phone: r.phone ?? (channel === "whatsapp" ? chatId : null) };
      const h = hidden.get(`${channel}:${chatId}`);
      if (h) return { username: h.identity?.username ?? null, phone: h.identity?.phone ?? (channel === "whatsapp" ? chatId : null) };
      return channel === "whatsapp" ? { username: null, phone: chatId } : null;
    },
    adapterOf: (channel, account) => o.adapterOf(channel, account),
    async idle() {
      while (inflight.size) await Promise.all([...inflight.values()]);
    },
  };
}
