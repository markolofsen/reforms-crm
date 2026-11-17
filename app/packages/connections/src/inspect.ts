import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CREDS_FILE, parseAccount, type ImapAccount } from "@hub/mail/imap";
import { mailId, notionId, TELEGRAM_ID, WHATSAPP_ID } from "./ids";
import { KIND_LABEL, NOTION_FILE, SAFE_FILE, TELEGRAM_FILE, isTelegramToken, notionShapeProblem, slug, type ConnectionKind } from "./kinds";
import { fileState, readValue } from "./store";

export type SecretState = "stored" | "missing" | "unsafe-mode" | "malformed" | "from-env" | "not-applicable";
export type ConnectionAction = "test" | "set" | "remove";

/** One connection, derived from the secrets folder and the projects' settings. There is no value field, so none can leak. */
export interface ConnectionRow {
  id: string;
  kind: ConnectionKind;
  label: string;
  secret: { state: SecretState; changedAt?: string };
  /** A public fact about the key (the IMAP user and host, ...). Never a secret. */
  identity: string | null;
  usedBy: string[];
  can: ConnectionAction[];
  note?: string;
}

/** What a project says about connections; the caller maps its own project type onto this. */
export interface ProjectUse { slug: string; mailAccounts: string[]; notionTokenFile: string }

export interface InspectInput {
  /** `hubPaths().secrets` */
  dir: string;
  /** Only `NOTION_TOKEN` is looked at. */
  env: NodeJS.ProcessEnv;
  projects: ProjectUse[];
  /** The live poller status, when the caller has it. */
  telegram?: { state: string; project?: string; reason?: string };
}

const NOTION_NOTE = "Needed for Overview counts and the database check. Agent sessions do not need it: they use the Notion connector signed in inside Claude.";
const WHATSAPP_NOTE = "Not connected, and nothing is built: the official API needs a public webhook and a dedicated business number, and the unofficial route can get the number banned.";

const byLabel = (a: ConnectionRow, b: ConnectionRow): number => a.label.localeCompare(b.label);

/** The state of a stored token file, with its shape check. */
function tokenState(dir: string, file: string, shapeOk: (v: string) => boolean): ConnectionRow["secret"] {
  const f = fileState(dir, file);
  if (f.state === "missing") return { state: "missing" };
  if (f.state === "unsafe-mode") return { state: "unsafe-mode", changedAt: f.changedAt };
  if (f.state === "empty") return { state: "malformed", changedAt: f.changedAt };
  const v = readValue(dir, file);
  return { state: v !== undefined && shapeOk(v) ? "stored" : "malformed", changedAt: f.changedAt };
}

const actions = (s: SecretState): ConnectionAction[] =>
  s === "stored" ? ["test", "set", "remove"] : s === "from-env" ? ["test"] : s === "missing" ? ["set"] : s === "not-applicable" ? [] : ["set", "remove"];

const problemNote = (s: SecretState): string | undefined =>
  s === "unsafe-mode" ? "The file is readable by others. Replace it, or run chmod 600 on it."
    : s === "malformed" ? "The file does not hold a usable value. Replace it or remove it."
      : undefined;

function notionRows(i: InspectInput): ConnectionRow[] {
  const files = new Set<string>([NOTION_FILE]);
  for (const p of i.projects) if (SAFE_FILE.test(p.notionTokenFile) && !p.notionTokenFile.includes("..")) files.add(p.notionTokenFile);
  return [...files].sort().map((file) => {
    const env = file === NOTION_FILE && !!i.env.NOTION_TOKEN?.trim();
    const secret: ConnectionRow["secret"] = env ? { state: "from-env" } : tokenState(i.dir, file, (v) => notionShapeProblem(v) === undefined);
    const usedBy = i.projects.filter((p) => p.notionTokenFile === file).map((p) => p.slug);
    const note = [env ? "Set by the NOTION_TOKEN environment variable, which wins over the file." : problemNote(secret.state), NOTION_NOTE].filter(Boolean).join(" ");
    return { id: notionId(file), kind: "notion", label: file === NOTION_FILE ? KIND_LABEL.notion : `${KIND_LABEL.notion} (${file})`, secret, identity: null, usedBy, can: actions(secret.state), note };
  });
}

interface MailFile { slug: string; account?: ImapAccount; problem?: string; secret: ConnectionRow["secret"] }

function mailFiles(dir: string): MailFile[] {
  let names: string[];
  try { names = readdirSync(dir).filter((n) => CREDS_FILE.test(n)).sort(); } catch { return []; }
  return names.map((n): MailFile => {
    const s = n.slice("mail-".length, -".json".length);
    const f = fileState(dir, n);
    if (f.state === "unsafe-mode") return { slug: s, secret: { state: "unsafe-mode", changedAt: f.changedAt } };
    if (f.state === "missing") return { slug: s, secret: { state: "malformed" }, problem: "the file vanished" };
    if (f.state === "empty") return { slug: s, secret: { state: "malformed", changedAt: f.changedAt }, problem: "the file is empty" };
    try {
      return { slug: s, account: parseAccount(readFileSync(join(dir, n), "utf8")), secret: { state: "stored", changedAt: f.changedAt } };
    } catch (e) {
      // parseAccount's reasons name a field, never a value.
      return { slug: s, secret: { state: "malformed", changedAt: f.changedAt }, problem: e instanceof Error ? e.message : "unreadable" };
    }
  });
}

function mailRows(i: InspectInput): ConnectionRow[] {
  const files = mailFiles(i.dir);
  const wants = (p: ProjectUse, f: MailFile): boolean => p.mailAccounts.some((a) => (f.account ? a.toLowerCase() === f.account.name.toLowerCase() : false) || slug(a) === f.slug);
  const rows: ConnectionRow[] = files.map((f) => {
    const usedBy = i.projects.filter((p) => wants(p, f)).map((p) => p.slug);
    const token = f.account !== undefined && "accessToken" in f.account.auth;
    const note = token ? "Token login, refreshed outside the hub: shown, not editable here." : f.problem ? `The file is unusable: ${f.problem}.` : problemNote(f.secret.state);
    return {
      id: mailId(f.slug), kind: "mail", label: f.account?.name ?? f.slug, secret: f.secret,
      identity: f.account ? `${f.account.user} at ${f.account.host}` : null, usedBy,
      can: token ? ["test"] : actions(f.secret.state), ...(note ? { note } : {}),
    };
  });
  // An account name a project lists that has no file. Apple Mail is the real send and read path, so this is not an error.
  const have = new Set(files.flatMap((f) => [f.slug, f.account?.name.toLowerCase() ?? ""]));
  const wanted = new Map<string, { name: string; usedBy: string[] }>();
  for (const p of i.projects) for (const a of p.mailAccounts) {
    if (have.has(slug(a)) || have.has(a.toLowerCase())) continue;
    const e = wanted.get(slug(a)) ?? { name: a, usedBy: [] };
    e.usedBy.push(p.slug);
    wanted.set(slug(a), e);
  }
  for (const [s, e] of wanted) {
    rows.push({ id: mailId(s), kind: "mail", label: e.name, secret: { state: "missing" }, identity: null, usedBy: e.usedBy, can: ["set"], note: "IMAP read login: not set (optional). It adds counts and Sent detection; Apple Mail stays the way mail is read and sent." });
  }
  return rows.sort(byLabel);
}

function telegramRow(i: InspectInput): ConnectionRow {
  const secret = tokenState(i.dir, TELEGRAM_FILE, isTelegramToken);
  const t = i.telegram;
  const poller = t ? (t.state === "running" ? `Poller running${t.project ? ` for ${t.project}` : ""}.` : `Poller ${t.state}${t.reason ? `: ${t.reason}` : ""}.`) : undefined;
  const note = [problemNote(secret.state), secret.state === "stored" ? "A new token applies on the next server start." : undefined, poller, "Use a new bot made in BotFather, never a bot that has a webhook."].filter(Boolean).join(" ");
  return { id: TELEGRAM_ID, kind: "telegram", label: KIND_LABEL.telegram, secret, identity: null, usedBy: t?.project ? [t.project] : [], can: actions(secret.state), note };
}

const whatsappRow = (): ConnectionRow => ({ id: WHATSAPP_ID, kind: "whatsapp", label: KIND_LABEL.whatsapp, secret: { state: "not-applicable" }, identity: null, usedBy: [], can: [], note: WHATSAPP_NOTE });

/** Every connection of this instance, in the order the panel lists them: Notion, mail, Telegram, WhatsApp. Reads files only; no network. */
export function inspect(i: InspectInput): ConnectionRow[] {
  return [...notionRows(i), ...mailRows(i), telegramRow(i), whatsappRow()];
}
