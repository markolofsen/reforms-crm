import { notionId, TELEGRAM_ID } from "./ids";
import { KIND_LABEL, NOTION_FILE, SAFE_FILE, TELEGRAM_FILE, isTelegramToken, notionShapeProblem, type ConnectionKind } from "./kinds";
import { fileState, readValue } from "./store";

export type SecretState = "stored" | "missing" | "unsafe-mode" | "malformed" | "from-env";
export type ConnectionAction = "test" | "set" | "remove";

/** One connection, derived from the secrets folder and the projects' settings. There is no value field, so none can leak. */
export interface ConnectionRow {
  id: string;
  kind: ConnectionKind;
  label: string;
  secret: { state: SecretState; changedAt?: string };
  /** A public fact about the key (the bot name, ...). Never a secret. */
  identity: string | null;
  usedBy: string[];
  can: ConnectionAction[];
  note?: string;
}

/** What a project says about connections; the caller maps its own project type onto this. */
export interface ProjectUse { slug: string; notionTokenFile: string }

export interface InspectInput {
  /** `hubPaths().secrets` */
  dir: string;
  /** Only `NOTION_TOKEN` is looked at. */
  env: NodeJS.ProcessEnv;
  projects: ProjectUse[];
  /** The live poller status, when the caller has it. */
  telegram?: { state: string; project?: string; reason?: string };
}

/** One line of purpose (UX pass 2026-11-20): what the key is for, and that the agent's own Notion sign-in is another thing. */
const NOTION_NOTE = "For the setup check of the Notion databases and the backups; agent sessions sign in to Notion on their own.";

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
  s === "stored" ? ["test", "set", "remove"] : s === "from-env" ? ["test"] : s === "missing" ? ["set"] : ["set", "remove"];

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

function telegramRow(i: InspectInput): ConnectionRow {
  const secret = tokenState(i.dir, TELEGRAM_FILE, isTelegramToken);
  const t = i.telegram;
  const poller = t ? (t.state === "running" ? `Poller running${t.project ? ` for ${t.project}` : ""}.` : `Poller ${t.state}${t.reason ? `: ${t.reason}` : ""}.`) : undefined;
  // Without a token the poller is off by definition: the row says "Not set", so only the one rule for a new key is said (UX pass).
  const note = secret.state === "missing" ? "Use a new bot made in BotFather, never one that has a webhook." : [problemNote(secret.state), secret.state === "stored" ? "A new token applies on the next server start." : undefined, poller].filter(Boolean).join(" ");
  return { id: TELEGRAM_ID, kind: "telegram", label: KIND_LABEL.telegram, secret, identity: null, usedBy: t?.project ? [t.project] : [], can: actions(secret.state), note };
}

/** Every connection of this instance, in the order the panel lists them: Notion, then Telegram. Reads files only; no network. */
export function inspect(i: InspectInput): ConnectionRow[] {
  return [...notionRows(i), telegramRow(i)];
}
