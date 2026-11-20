import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Repos } from "@hub/db";
import { matchDialog, MATCH_REASON, type DialogIdentity, type DirectoryEntry } from "@hub/messengers";
import { autoLinkUserChat, type LinkableAdapter } from "@hub/messengers/human";
import type { UserDialog } from "@hub/messengers";
import type { ClientDirectory } from "./client-directory";

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
}

export interface AutolinkState {
  project: string | null;
  enabled: boolean;
  recent: RecentDialog[];
  /** Distinct unlinked chats that wrote since the server started: a number in memory, never stored (0036 point 3 as amended). */
  unlinkedActive: number;
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
  /** "Never link this chat": its HMAC is stored; the caller unlinks it. */
  refuse(channel: UserChannel, chatId: string): Promise<void>;
  /** A directory record by its key, for the owner's Link from the Chats screen. */
  record(key: string): DirectoryEntry | null;
  /** Up to 8 directory records whose name or email holds `q` (two or more characters). */
  findRecords(q: string): Candidate[];
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
  const active = new Set<string>();
  const inflight = new Map<string, Promise<void>>();
  let refused: Set<string> | null = null;
  let key: string | null = null;

  const hmac = (channel: UserChannel, chatId: string) => createHmac("sha256", (key ??= keyOf(o.keyFile))).update(`${o.project}\n${channel}\n${chatId}`).digest("hex");
  const refusals = async () => (refused ??= new Set(o.project ? (await o.repos.messengers.linkRefusals(o.project)).map((r) => `${r.channel}:${r.hash}`) : []));
  const isRefused = async (channel: UserChannel, chatId: string) => (await refusals()).has(`${channel}:${hmac(channel, chatId)}`);

  const remember = (r: RecentDialog) => {
    const k = `${r.channel}:${r.chatId}`;
    recent.delete(k);
    recent.set(k, r);
    while (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value ?? "");
  };

  async function activity(project: string, clientId: number, name: string, channel: UserChannel, reason: string, imported: number) {
    const at = now().toISOString();
    const runId = await o.repos.runs.start({ project, startedAt: at, finishedAt: at, trigger: "autolink", skill: null, status: "ok" });
    const why = `${CHANNEL_WORD[channel]} chat, ${reason}; ${imported} ${imported === 1 ? "message" : "messages"} of the last 30 days imported. Next: say "triage messages for ${name}".`;
    await o.repos.runs.addEvent({ project, runId, at, kind: "decision", tool: null, summary: `Linked ${name}'s ${CHANNEL_WORD[channel]} chat: ${name}`, detail: JSON.stringify({ action: "linked", reason: why, channel }), clientId });
  }

  async function consider(channel: UserChannel, account: string, d: DialogIdentity): Promise<void> {
    const project = o.project;
    if (!project) return;
    if (await o.repos.messengers.isAllowed(project, channel, d.chatId)) {
      recent.delete(`${channel}:${d.chatId}`);
      return;
    }
    if (await isRefused(channel, d.chatId)) return;
    const base = { channel, account, chatId: d.chatId, title: d.title, seenAt: now().toISOString() };
    const dir = o.directory.current();
    const m = dir ? matchDialog(dir, d) : ({ kind: "none" } as const);
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

  const run = (channel: UserChannel, account: string, d: DialogIdentity) => {
    const k = `${channel}:${d.chatId}`;
    if (inflight.has(k)) return inflight.get(k)!;
    const p = consider(channel, account, d)
      .catch(() => undefined)
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  };

  return {
    seen(channel, account, d, inbound) {
      if (inbound) active.add(`${channel}:${d.chatId}`);
      void run(channel, account, d);
    },
    async scan(channel, account) {
      const adapter = o.adapterOf(channel, account);
      if (!adapter || !o.project) return;
      const ds = await adapter.dialogs(SCAN_DIALOGS).catch(() => [] as UserDialog[]);
      for (const d of ds) await run(channel, account, d);
    },
    async state() {
      const enabled = o.project ? await o.enabled() : false;
      // A chat linked since it was remembered (by the owner or a later match) leaves the list.
      const rows = [...recent.values()].reverse();
      const live: RecentDialog[] = [];
      for (const r of rows) if (o.project && !(await o.repos.messengers.isAllowed(o.project, r.channel, r.chatId))) live.push(r);
      return { project: o.project, enabled, recent: live, unlinkedActive: active.size };
    },
    async preview() {
      const out: PreviewCounts[] = [];
      const dir = o.directory.current();
      for (const { channel, account } of o.accounts()) {
        const adapter = o.adapterOf(channel, account);
        if (!adapter) continue;
        const ds = await adapter.dialogs(channel === "whatsapp" ? 2000 : SCAN_DIALOGS).catch(() => [] as UserDialog[]);
        const c: PreviewCounts = { channel, account, dialogs: ds.length, linked: 0, unique: 0, ambiguous: 0, noEmail: 0, byRelationship: {} };
        for (const d of ds) {
          if (o.project && (await o.repos.messengers.isAllowed(o.project, channel, d.chatId))) {
            c.linked++;
            continue;
          }
          const m = dir ? matchDialog(dir, d) : ({ kind: "none" } as const);
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
    async refuse(channel, chatId) {
      if (!o.project) return;
      const h = hmac(channel, chatId);
      await o.repos.messengers.refuseLink(o.project, channel, h);
      (await refusals()).add(`${channel}:${h}`);
      recent.delete(`${channel}:${chatId}`);
    },
    record(k) {
      const dir = o.directory.current();
      if (!dir) return null;
      return dir.all.find((e) => e.key === k) ?? null;
    },
    findRecords(q) {
      const term = q.trim().toLowerCase();
      const dir = o.directory.current();
      if (term.length < 2 || !dir) return [];
      return dir.all.filter((e) => e.email && (e.name.toLowerCase().includes(term) || e.email.includes(term))).slice(0, 8).map(candidateOf);
    },
    adapterOf: (channel, account) => o.adapterOf(channel, account),
    async idle() {
      while (inflight.size) await Promise.all([...inflight.values()]);
    },
  };
}
