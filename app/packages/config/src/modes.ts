// P126 K1 (verdict 3.7): the ONE reader of the environment switches a long-running process is started with. A fake never
// leaves the process; it is for the e2e run and demos only, so every fake that could reach live data is refused unless
// `HUB_DB` names a throwaway database (the default path is the live one). A fake switch spelled any other way ("1", "true",
// "FAKE", a typo) is an error, never a silent fall back. An off switch is off only when it is exactly "off" (today's rule:
// it only removes work). The e2e run keeps its variable names (`apps/admin/playwright.config.ts`).

interface FakeSwitch<Real extends string> {
  variable: string;
  real: Real;
  /** Refused without a throwaway `HUB_DB`: the fake would otherwise run beside an instance's live data. */
  throwaway: boolean;
  /** What the one start line says while it is fake. */
  says: string;
}

interface OffSwitch {
  variable: string;
  says: string;
}

const FAKES = {
  mailer: { variable: "HUB_MAILER", real: "mail-app", throwaway: true, says: "send (nothing leaves this process)" },
  llm: { variable: "HUB_LLM", real: "real", throwaway: false, says: "the model (no request leaves this process)" },
  probe: { variable: "HUB_CONNECTIONS_PROBE", real: "real", throwaway: true, says: "connection tests (nothing is sent to Notion or Telegram)" },
  shell: { variable: "HUB_TERMINAL_SHELL", real: "login", throwaway: true, says: "the terminal shell" },
  agentTools: { variable: "HUB_AGENT_TOOLS", real: "real", throwaway: true, says: "the Agent tools checks" },
  launchctl: { variable: "HUB_LAUNCHCTL", real: "launchctl", throwaway: true, says: "launchctl (launchd is not asked)" },
  opener: { variable: "HUB_OPENER", real: "open", throwaway: true, says: "Open (nothing is opened)" },
} as const satisfies Record<string, FakeSwitch<string>>;

const OFFS = {
  messengers: { variable: "HUB_MESSENGERS", says: "the messenger accounts" },
  inbound: { variable: "HUB_INBOUND", says: "the Mail reader" },
  sent: { variable: "HUB_SENT", says: "Sent detection" },
} as const satisfies Record<string, OffSwitch>;

export type FakeKey = keyof typeof FAKES;
export type OffKey = keyof typeof OFFS;

export type RuntimeModes = { [K in FakeKey]: (typeof FAKES)[K]["real"] | "fake" } & { [K in OffKey]: "on" | "off" };

/** `mail-app` (Mail.app through osascript) or `fake` (in memory). */
export type MailerKind = RuntimeModes["mailer"];

type Env = Readonly<Record<string, string | undefined>>;

/** True when `HUB_DB` names a database file, so a fake that must never touch live data may run. */
const throwawayDb = (env: Env): boolean => !!env.HUB_DB && env.HUB_DB !== ":memory:";

/** One fake switch, read alone (a package that knows only its own, such as `@hub/llm`). Throws on a bad value. */
export function fakeMode<K extends FakeKey>(env: Env, key: K): (typeof FAKES)[K]["real"] | "fake" {
  const s: FakeSwitch<(typeof FAKES)[K]["real"]> = FAKES[key];
  const v = env[s.variable];
  if (v === undefined || v === "") return s.real;
  if (v !== "fake") throw new Error(`${s.variable} must be unset or exactly "fake", got "${v}"`);
  if (s.throwaway && !throwawayDb(env)) throw new Error(`${s.variable}=fake needs HUB_DB set to a throwaway database file: the default database is the live one`);
  return "fake";
}

/** One off switch, read alone: `off` only when it is exactly "off". */
export const offMode = (env: Env, key: OffKey): "on" | "off" => (env[OFFS[key].variable] === "off" ? "off" : "on");

/** Every switch at once, read once at start; throws on the first bad fake value. */
export function runtimeModes(env: Env = process.env): RuntimeModes {
  return {
    mailer: fakeMode(env, "mailer"),
    llm: fakeMode(env, "llm"),
    probe: fakeMode(env, "probe"),
    shell: fakeMode(env, "shell"),
    agentTools: fakeMode(env, "agentTools"),
    launchctl: fakeMode(env, "launchctl"),
    opener: fakeMode(env, "opener"),
    messengers: offMode(env, "messengers"),
    inbound: offMode(env, "inbound"),
    sent: offMode(env, "sent"),
  };
}

/** The one start line about the switches: every fake and every off one by name, or null when all are real and on. */
export function modesLine(m: RuntimeModes): string | null {
  const fakes = (Object.keys(FAKES) as FakeKey[]).filter((k) => m[k] === "fake").map((k) => `${FAKES[k].says} (${FAKES[k].variable}=fake)`);
  const offs = (Object.keys(OFFS) as OffKey[]).filter((k) => m[k] === "off").map((k) => `${OFFS[k].says} (${OFFS[k].variable}=off)`);
  if (!fakes.length && !offs.length) return null;
  return [fakes.length ? `FAKE: ${fakes.join(", ")}` : "", offs.length ? `OFF: ${offs.join(", ")}` : ""].filter(Boolean).join("; ");
}
