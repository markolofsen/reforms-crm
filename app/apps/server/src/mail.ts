import { createImapHistory, imapflowConnect, loadAccounts, redactSecrets, secretsDir, type ImapAccount, type ImapConnect } from "@hub/mail/imap";
import type { Repos } from "@hub/db";
import type { MailPages } from "@hub/messengers";

/**
 * Mail for the server, read only. Logins are `state/secrets/mail-*.json` (git-ignored, mode 600), read again on every
 * connection. A project reads only the accounts it lists under `mail.accounts`: a file nobody lists is never opened.
 * Mail is off without a matching file, and that is a normal state, not an error.
 */
export interface MailStatus {
  state: "off" | "ready";
  reason?: string;
  /** Login files in the config folder that loaded. */
  accounts: number;
  /** Files that did not load (mode, shape). Names and reasons only, never a value. */
  problems: string[];
}

export interface MailService {
  /** The logins `project` may read. */
  accountsFor(project: string): Promise<ImapAccount[]>;
  /** The history reader of `project`, or undefined when it has no login. */
  historyFor(project: string): Promise<MailPages | undefined>;
  connect: ImapConnect;
  status(): MailStatus;
  /** Removes every known secret from a text. */
  redact(text: string): string;
}

export interface MailServiceOptions {
  repos: Repos;
  env?: NodeJS.ProcessEnv;
  /** Default: `<home>/state/secrets`, or `HUB_CONFIG_DIR`. */
  configDir?: string;
  /** Default: imapflow. Tests pass `FakeImapServer.connect`. */
  connect?: ImapConnect;
}

/** `mail.accounts` and `mail.addresses` from a registry row (`projects.settings_json`, the parsed project.md). */
export function projectMail(settingsJson: string | null | undefined): { accounts: string[]; addresses: string[] } {
  try {
    const m = (JSON.parse(settingsJson ?? "{}") as { mail?: { accounts?: unknown; addresses?: unknown } }).mail;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return { accounts: list(m?.accounts), addresses: list(m?.addresses) };
  } catch {
    return { accounts: [], addresses: [] };
  }
}

export function createMailService(o: MailServiceOptions): MailService {
  const env = o.env ?? process.env;
  const disabled = env.HUB_MAIL === "off";
  const load = () => loadAccounts(o.configDir ?? secretsDir(env));
  const readers = new Map<string, MailPages>();

  async function names(project: string): Promise<{ accounts: string[]; addresses: string[] }> {
    return projectMail((await o.repos.projects.get(project))?.settingsJson);
  }
  const pick = (all: ImapAccount[], wanted: string[]) => {
    const w = new Set(wanted.map((n) => n.trim().toLowerCase()));
    return all.filter((a) => w.has(a.name.toLowerCase()));
  };

  const service: MailService = {
    connect: o.connect ?? imapflowConnect,
    async accountsFor(project) {
      if (disabled) return [];
      return pick(load().accounts, (await names(project)).accounts);
    },
    async historyFor(project) {
      if (disabled) return undefined;
      const { accounts, addresses } = await names(project);
      if (pick(load().accounts, accounts).length === 0) return undefined;
      const key = `${project}\u0000${accounts.join(",")}\u0000${addresses.join(",")}`;
      let r = readers.get(key);
      if (!r) {
        r = createImapHistory({ accounts: () => pick(load().accounts, accounts), connect: service.connect, me: addresses });
        readers.set(key, r);
      }
      return r;
    },
    status() {
      if (disabled) return { state: "off", reason: "HUB_MAIL=off", accounts: 0, problems: [] };
      const l = load();
      return l.accounts.length === 0
        ? { state: "off", reason: l.problems.length ? "no usable mail login file" : "no mail login file", accounts: 0, problems: l.problems }
        : { state: "ready", accounts: l.accounts.length, problems: l.problems };
    },
    redact: (text) => redactSecrets(text, load().accounts),
  };
  return service;
}

export const MAIL_OFF: MailStatus = { state: "off", reason: "not started", accounts: 0, problems: [] };
