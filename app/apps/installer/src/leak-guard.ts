// P89 verdict 14 (decision 0043): what the PUBLIC core must never track. One list, used by `public-core.test.ts` on the core's own
// `git ls-files`.
// Owner names are not here: they are the private list of `layers.test.ts` (`config/custom-names.txt`).

export interface Leak { file: string; why: string }

/** Paths of the core that hold one owner's data. */
export function pathLeaks(files: readonly string[]): Leak[] {
  const out: Leak[] = [];
  for (const f of files) {
    const parts = f.split("/");
    const why = ((): string | undefined => {
      if (parts[0] === "app" && parts[1] === "projects" && parts[2] && !parts[2].startsWith("_") && parts.length > 3) return "a real project in the core (only app/projects/_template may be tracked)";
      if (f.startsWith("@docs/custom/") || f.startsWith("@dev/") || f.startsWith("@refs/")) return "an instance folder in the core";
      if (f.startsWith("projects/")) return "an instance projects folder in the core";
      if (/(^|\/)projects\/[^/]+\/(dumps|reports|\.generated)\//.test(f)) return "derived client data (dumps, reports, generated)";
      if (/(^|\/)projects\/[^/]+\/knowledge\/notion\//.test(f)) return "a Notion copy of client data";
      if (/^(state|data|backups)\//.test(f) && f !== "state/.gitkeep") return "working state, the database or a backup";
      if (/(^|\/)state\/secrets\//.test(f)) return "a secret folder";
      if (/\.(db|db-wal|db-shm|db-journal|sqlite|sqlite3)$/.test(f)) return "a database file";
      if (/(^|\/)\.env(\.[^/]*)?$/.test(f) && !/\.(example|sample|template)$/.test(f)) return "an env file";
      if (/\.(pem|key|p12)$/.test(f)) return "a key file";
      if (/(^|\/)(notion-token|telegram-bot-token|openrouter-key|claude-token)$/.test(f)) return "a token file";
      return undefined;
    })();
    if (why) out.push({ file: f, why });
  }
  return out;
}

/** Token shapes of the services the Hub touches. A test fixture (a path under test/, e2e/ or a *.test.* / *.spec.* file) may hold a fake one. */
export const TOKEN_SHAPES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "Notion token", re: /\b(ntn|secret)_[A-Za-z0-9]{30,}/ },
  { name: "GitHub token", re: /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { name: "API key (sk-)", re: /\bsk-(or-|ant-|proj-)?[A-Za-z0-9_-]{30,}/ },
  { name: "Slack token", re: /\bxox[abpr]-[A-Za-z0-9-]{20,}/ },
  { name: "Telegram bot token", re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/ },
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

export const isFixturePath = (f: string): boolean => /(^|\/)(test|tests|e2e|__tests__|fixtures)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);

export function textLeaks(file: string, text: string): Leak[] {
  if (isFixturePath(file)) return [];
  return TOKEN_SHAPES.filter((t) => t.re.test(text)).map((t) => ({ file, why: `a ${t.name} shape` }));
}

export const TEXT_FILE = /\.(md|ts|tsx|js|mjs|cjs|json|sh|txt|yaml|yml|toml|env|html|css)$|(^|\/)[^/.]+$/;
