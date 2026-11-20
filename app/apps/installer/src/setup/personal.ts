import type { Situation } from "./situation";

/**
 * P89 verdict 6: what is PERSONAL on this Mac and cannot come with the repo: each line its state and the exact fix, typed by the person,
 * never by setup. Built from facts the wizard gathers (doctor rows, Mail's account list, files' existence), so the text is testable.
 */
export type ItemState = "done" | "missing" | "optional" | "unknown";
export interface PersonalItem { id: string; label: string; state: ItemState; detail: string; fix?: string }

export interface PersonalFacts {
  situation: Situation;
  person?: string;
  /** Each project's Mail accounts (project.md `mail.accounts`). */
  projectAccounts: { slug: string; accounts: string[] }[];
  /** Mail's own account names, or undefined when Mail could not be asked (mail-mcp down, Mail closed). */
  mailAccounts?: string[];
  /** The `agent.clis` doctor row. */
  clis?: { ok: boolean; detail: string };
  /** The `autostart.agent` doctor row. */
  autostart?: { ok: boolean; detail: string };
  /** `state/secrets/notion-token` exists (its value is never read here). */
  notionToken: boolean;
  /** Messenger sessions of this Mac (folder names under `state/secrets/sessions/`). */
  messengerSessions: string[];
  /** The slug a session would start with, for the fix lines. */
  firstProject?: string;
  /** The `instance.core` row's update note, when origin has a newer core. */
  coreUpdate?: string;
}

const lower = (s: string) => s.trim().toLowerCase();

export function personalChecklist(f: PersonalFacts): PersonalItem[] {
  const items: PersonalItem[] = [];
  const slug = f.firstProject ?? "<project>";
  items.push(f.person
    ? { id: "person", label: "Your name", state: "done", detail: `${f.person} (state/person.json; Notion's "Last sent by" shows it)` }
    : { id: "person", label: "Your name", state: "missing", detail: "not set: a send cannot say who sent it", fix: './run.sh setup --person "Your Name"' });

  for (const p of f.projectAccounts) {
    if (!p.accounts.length) { items.push({ id: `mail.${p.slug}`, label: `Mail for ${p.slug}`, state: "unknown", detail: "the project lists no Mail account yet (the project interview sets mail.accounts)" }); continue; }
    if (!f.mailAccounts) {
      items.push({ id: `mail.${p.slug}`, label: `Mail for ${p.slug}`, state: "unknown", detail: `Mail could not be asked (Mail closed or mail-mcp not running); needed: ${p.accounts.join(", ")}`, fix: "open Apple Mail, then ./run.sh setup again" });
      continue;
    }
    const have = new Set(f.mailAccounts.map(lower));
    const missing = p.accounts.filter((a) => !have.has(lower(a)));
    items.push(missing.length
      ? { id: `mail.${p.slug}`, label: `Mail for ${p.slug}`, state: "missing", detail: `not in Apple Mail on this Mac: ${missing.join(", ")}`, fix: `Apple Mail ▸ Settings ▸ Accounts ▸ + : add ${missing.join(", ")} with YOUR OWN login, named exactly so (a shared mailbox is fine; its drafts are each person's own)` }
      : { id: `mail.${p.slug}`, label: `Mail for ${p.slug}`, state: "done", detail: p.accounts.join(", ") });
  }

  if (f.clis) items.push(f.clis.ok
    ? { id: "agent", label: "Agent CLIs signed in", state: "done", detail: f.clis.detail }
    : { id: "agent", label: "Agent CLIs signed in", state: "missing", detail: f.clis.detail, fix: "install with npm i -g @anthropic-ai/claude-code (or @openai/codex), then sign in with YOUR account: claude auth login / codex login" });

  items.push({ id: "notion.connector", label: "Notion in your sessions", state: "unknown", detail: "each person signs in with their own Notion account (a member of the project's teamspace); setup cannot see a CLI's sign-in", fix: `./run.sh agent ${slug}, type /mcp, pick notion, Authenticate (Codex: the line on Settings ▸ Agent)` });
  items.push(f.notionToken
    ? { id: "notion.token", label: "Notion read token", state: "done", detail: "state/secrets/notion-token is present (doctor, backups, the Last sent stamp)" }
    : { id: "notion.token", label: "Notion read token", state: "optional", detail: "absent: the doctor's Notion check, backups and the Last sent stamp are off on this Mac", fix: "ask the instance owner for the team's integration token through a password manager (never git or chat), then ./run.sh token notion" });

  if (f.autostart) items.push(f.autostart.ok
    ? { id: "autostart", label: "Starts after a restart", state: "done", detail: f.autostart.detail }
    : { id: "autostart", label: "Starts after a restart", state: "optional", detail: f.autostart.detail, fix: "./run.sh install --only autostart.agent (off again: ./run.sh autostart off)" });

  const tg = f.messengerSessions.some((s) => s.startsWith("telegram")), wa = f.messengerSessions.some((s) => s.startsWith("whatsapp"));
  items.push(tg || wa
    ? { id: "messengers", label: "Telegram / WhatsApp", state: "done", detail: `${[tg ? "Telegram" : "", wa ? "WhatsApp" : ""].filter(Boolean).join(" and ")} signed in on this Mac` }
    : { id: "messengers", label: "Telegram / WhatsApp", state: "optional", detail: "not connected on this Mac (optional)", fix: "your OWN account only: ./run.sh up, Messengers ▸ Settings; never copy another person's session folder (a copied session is a second device on one key: 440, ban risk)" });

  if (f.coreUpdate) items.push({ id: "core", label: "Core update", state: "optional", detail: f.coreUpdate, fix: "agree it with the team: one person moves the pin (./run.sh core update <tag> --apply), commits core.version, the others git pull --recurse-submodules" });
  return items;
}

const MARK: Record<ItemState, string> = { done: "ok  ", missing: "TODO", optional: "opt ", unknown: "?   " };

export function personalText(items: readonly PersonalItem[], situation: Situation): string {
  const lines = items.map((i) => `${MARK[i.state]} ${i.label}: ${i.detail}${i.fix ? `\n       fix: ${i.fix}` : ""}`);
  const team = situation === "new"
    ? ["", "Shared: the private repo (config, knowledge, workflows) and Notion. Personal: data/app.db, drafts, sessions, mailboxes. Never put this folder on Google Drive."]
    : ["", "Every day: git pull --rebase --recurse-submodules before you start; commit small changes to project.md and knowledge; drafts and Activity stay on your Mac."];
  return [...lines, ...team].join("\n");
}
