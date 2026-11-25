import { existsSync, readFileSync } from "node:fs";
import { AGENT_CLIS, type AgentCli, type HubPaths } from "./paths";

// P126 K1 (verdict 3.7): the ONE reader of the instance file `config/config.json`. Read on every call, never cached (the
// owner edits it while the server runs). Each field is read on its own: a malformed field is left out and named in
// `problems` (the doctor shows them), the rest still applies, so one typo never turns another switch. `@hub/config` has no
// dependencies, so the schema is this table of field readers rather than a zod object.

export interface InstanceConfigFile {
  name?: string;
  logo?: string;
  /** Who `draft.recipients: test` may write to: addresses, `telegram:<id>`, `whatsapp:+<number>`. */
  allow_list?: string[];
  extra_dirs?: string[];
  account?: string;
  /** The Mail mailboxes the doctor reads (`mail.account`); the first one is read. */
  mailboxes?: string[];
  /** Carried by the template only. */
  sent_mailbox?: string;
  /** Raw, as written: `hub backup` refuses a malformed one rather than falling back to the default folder. */
  backup_dir?: unknown;
  /** More git checkouts `backup.git` checks, relative to the instance folder. */
  backup_repos?: string[];
  /** Raw, as written: `instancePorts` refuses a malformed one rather than falling back. */
  admin_port?: unknown;
  api_port?: unknown;
  log?: { retention_days?: number };
  llm?: { monthly_cap_usd?: number; presets?: Record<string, string[]> };
  agent?: { default?: AgentCli };
}

export interface InstanceConfigRead {
  config: InstanceConfigFile;
  /** One sentence per field left out, and one when the file is not JSON; empty when the file is missing. */
  problems: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
/** A list keeps its strings (and drops blank ones when `nonEmpty`); an entry of another type is skipped, as every reader did. */
const strings = (v: unknown, nonEmpty: boolean): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && (!nonEmpty || x.trim() !== "")) : undefined);

type Reader<T> = (v: unknown) => { ok: true; value: T } | { ok: false; why: string };
const field =
  <T>(read: (v: unknown) => T | undefined, why: string): Reader<T> =>
  (v) => {
    const value = read(v);
    return value === undefined ? { ok: false, why } : { ok: true, value };
  };

const retention = field((v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 3650 ? v : undefined), "log.retention_days must be a whole number from 1 to 3650");
const cap = field((v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10_000 ? v : undefined), "llm.monthly_cap_usd must be a number from 0 to 10000");
const presets = field((v) => {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [name, list] of Object.entries(v)) if (Array.isArray(list) && list.length > 0 && list.every((m): m is string => typeof m === "string" && m.length > 0)) out[name] = list;
  return out;
}, "llm.presets must be an object of model lists");
// AGENT_CLIS is read at call time only: `./paths` imports this module too.
const cli = field((v) => AGENT_CLIS.find((c) => c === v), "agent.default must be claude or codex");

type Raw = "log" | "llm" | "agent" | "admin_port" | "api_port" | "backup_dir";
const TOP: { [K in Exclude<keyof InstanceConfigFile, Raw>]: Reader<NonNullable<InstanceConfigFile[K]>> } = {
  name: field(text, "name must be a non-empty string"),
  logo: field(text, "logo must be a non-empty string"),
  allow_list: field((v) => strings(v, false), "allow_list must be a list of strings"),
  extra_dirs: field((v) => strings(v, true), "extra_dirs must be a list of strings"),
  account: field(text, "account must be a non-empty string"),
  mailboxes: field((v) => strings(v, true), "mailboxes must be a list of mailbox names"),
  sent_mailbox: field(text, "sent_mailbox must be a non-empty string"),
  backup_repos: field((v) => strings(v, true), "backup_repos must be a list of folders"),
};

/** Every top-level key of `config/config.json`: the whole schema (the doctor's `files.config-keys` warns on any other). */
export const INSTANCE_KEYS = ["name", "logo", "account", "mailboxes", "sent_mailbox", "allow_list", "extra_dirs", "admin_port", "api_port", "backup_dir", "backup_repos", "log", "agent", "llm"] as const satisfies readonly (keyof InstanceConfigFile)[];

/** `config/config.json` of the instance, read once per call. A missing file is an empty config with no problem. */
export function readInstanceConfig(paths: Pick<HubPaths, "configFile">): InstanceConfigRead {
  if (!existsSync(paths.configFile)) return { config: {}, problems: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(paths.configFile, "utf8"));
  } catch {
    return { config: {}, problems: [`${paths.configFile} is not valid JSON: every setting in it is ignored`] };
  }
  if (!isRecord(raw)) return { config: {}, problems: [`${paths.configFile} is not a JSON object: every setting in it is ignored`] };
  const config: InstanceConfigFile = {};
  const problems: string[] = [];
  const take = <T>(v: unknown, r: Reader<T>, set: (x: T) => void) => {
    if (v === undefined) return;
    const got = r(v);
    if (got.ok) set(got.value);
    else problems.push(got.why);
  };
  take(raw.name, TOP.name, (x) => (config.name = x));
  take(raw.logo, TOP.logo, (x) => (config.logo = x));
  take(raw.allow_list, TOP.allow_list, (x) => (config.allow_list = x));
  take(raw.extra_dirs, TOP.extra_dirs, (x) => (config.extra_dirs = x));
  take(raw.account, TOP.account, (x) => (config.account = x));
  take(raw.mailboxes, TOP.mailboxes, (x) => (config.mailboxes = x));
  take(raw.sent_mailbox, TOP.sent_mailbox, (x) => (config.sent_mailbox = x));
  take(raw.backup_repos, TOP.backup_repos, (x) => (config.backup_repos = x));
  if (raw.backup_dir !== undefined) config.backup_dir = raw.backup_dir;
  if (raw.admin_port !== undefined) config.admin_port = raw.admin_port;
  if (raw.api_port !== undefined) config.api_port = raw.api_port;
  if (isRecord(raw.log)) {
    const log: NonNullable<InstanceConfigFile["log"]> = {};
    take(raw.log.retention_days, retention, (x) => (log.retention_days = x));
    config.log = log;
  }
  if (isRecord(raw.llm)) {
    const llm: NonNullable<InstanceConfigFile["llm"]> = {};
    take(raw.llm.monthly_cap_usd, cap, (x) => (llm.monthly_cap_usd = x));
    take(raw.llm.presets, presets, (x) => (llm.presets = x));
    config.llm = llm;
  }
  if (isRecord(raw.agent)) {
    const agent: NonNullable<InstanceConfigFile["agent"]> = {};
    take(raw.agent.default, cli, (x) => (agent.default = x));
    config.agent = agent;
  }
  return { config, problems };
}
