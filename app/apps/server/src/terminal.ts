import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import path from "node:path";
import { instanceFeatures, type HubPaths } from "@hub/config/paths";
import { cliDetector, detectClis, fakeFacts, pickPreset, type CliDetector } from "@hub/agent/detect";
import { codexHome } from "@hub/agent/codex";
import { MEASURED_VERSIONS } from "@hub/agent/session";
import { sessionInstructions } from "@hub/agent/session-rules";
import { logStoreOf } from "@hub/log/store";
import { chooseResume, type LoggedSession, type ResumeChoice } from "@hub/log/resume";
import type { CliFactDto, TerminalPreset, TerminalSessionDto } from "@hub/contract/terminal";
import type { Repos } from "@hub/db";
import { nodePty, presetArgv, presetOrder, SessionLimitError, sessionManager, sessionTitle, spawnLine, terminalEnv, terminalSocketServer, type PtySpawn, type SessionManager } from "@hub/terminal";
import { throwawayDbNamed } from "@hub/send";
import { gateRefusal, ticketStore, type TicketStore } from "./admin-gate";

// The embedded terminal's server side (P49 section 4, guards S1 to S7). Off unless `terminal.enabled` is exactly true in
// the instance config; off, every terminal route and the upgrade are 404. The socket goes straight to this port (not
// through Next's `/api` rewrite) and opens only for the admin's exact origin with a single-use ticket.

export const TERMINAL_PATH = "/terminal";
/** A socket ticket lives 30 s (the page fetches one right before it connects). */
const TICKET_TTL_MS = 30_000;

export interface TerminalOptions {
  paths: HubPaths;
  repos: Repos;
  adminPort: number;
  apiPort: number;
  /** Tests: a fake PTY; default node-pty, loaded on the first session only. */
  spawn?: PtySpawn;
  /** `HUB_TERMINAL_SHELL=fake`: the fake shell of `test-support/` (refused without `HUB_DB`, like `HUB_MAILER=fake`). */
  fakeShell?: boolean;
  env?: NodeJS.ProcessEnv;
  nodeBin?: string;
  tickets?: TicketStore;
  /** Which CLIs this Mac can start (P57); shared with Agent tools. Default: the login-shell detector (the fake one with the fake shell). */
  detector?: CliDetector;
  /** Tests: the clock the resume cut-off reads (P64). */
  now?: () => Date;
}

/** The quiet line under the tabs when the automatic start resumed (P64): which session, from when; `+` starts a new one. */
export function resumedLine(s: LoggedSession, cli: "claude" | "codex"): string {
  const t = new Date(s.lastAt);
  const hhmm = Number.isNaN(t.getTime()) ? s.lastAt : `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  return `Resumed the ${cli === "claude" ? "Claude Code" : "Codex"} session of ${hhmm} (${s.session.slice(0, 8)}). + starts a new one.`;
}

/** The detector the server shares between the terminal and Agent tools: fixed ready facts with a fake shell or fake Agent tools. */
export function serverDetector(o: { env: NodeJS.ProcessEnv; fake: boolean }): CliDetector {
  return cliDetector({ detect: o.fake ? async () => fakeFacts(MEASURED_VERSIONS) : () => detectClis({ env: o.env }) });
}

/** The wire half of a fact: no path. */
const wireFact = ({ cli, state, version, detail, fix }: CliFactDto): CliFactDto => ({ cli, state, version, detail, fix });

/** `HUB_TERMINAL_SHELL`: unset (the owner's shell) or `fake`; `fake` needs `HUB_DB`, so it can never run against an instance's live data. */
export function chooseShell(env: NodeJS.ProcessEnv): "login" | "fake" {
  const v = env.HUB_TERMINAL_SHELL?.trim();
  if (!v) return "login";
  if (v !== "fake") throw new Error(`HUB_TERMINAL_SHELL must be unset or "fake", got "${v}"`);
  if (!throwawayDbNamed(env)) throw new Error("HUB_TERMINAL_SHELL=fake needs HUB_DB set to a throwaway database file: the default database is the live one");
  return "fake";
}

export class TerminalRefusal extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); }
}

export function createTerminal(o: TerminalOptions) {
  const env = o.env ?? process.env;
  const nodeBin = o.nodeBin ?? process.execPath;
  const tickets = o.tickets ?? ticketStore({ ttlMs: TICKET_TTL_MS });
  const features = () => instanceFeatures(o.paths);
  const fake = o.fakeShell ?? chooseShell(env) === "fake";
  const detector = o.detector ?? serverDetector({ env, fake });
  let manager: SessionManager | null = null;
  // A session that ends may have been his `claude auth login`, `codex login` or an install: the next pick reads fresh facts.
  const sessions = (): SessionManager => (manager ??= sessionManager({ spawn: o.spawn ?? nodePty(), onExit: () => void detector.refresh() }));

  /** `resume`: a session id from the log (P64, `ensure` only); the `+` menu never passes one, so it always starts fresh. */
  async function create(preset: TerminalPreset, project: string | undefined, theme?: "light" | "dark", resume?: string) {
    const slug = project ?? null;
    if (slug && (await o.repos.projects.get(slug)) === null) throw new TerminalRefusal(404, `no project "${slug}"`);
    if (!presetOrder(features().agent.default, !!slug).includes(preset)) throw new TerminalRefusal(400, `${preset} needs a project in the address`);
    const argv = presetArgv(preset, slug, { nodeBin, hubBin: o.paths.hubBin, resume });
    // The fake shell gets the agent's argv after `--exec` and prints it, so tests see exactly what would run.
    const shell = fake
      ? { file: nodeBin, args: [path.join(o.paths.core, "app", "test-support", "fake-shell.mjs"), ...(argv ? ["--exec", ...argv] : [])] }
      : spawnLine(env.SHELL?.trim() || "/bin/zsh", argv);
    try {
      return sessions().create({
        preset,
        project: slug,
        title: sessionTitle(preset, slug, !!resume),
        ...shell,
        cwd: o.paths.home,
        env: terminalEnv({ base: env, home: o.paths.home, project: slug, nodeBin, theme }),
      });
    } catch (e) {
      if (e instanceof SessionLimitError) throw new TerminalRefusal(409, e.message);
      throw e;
    }
  }

  /**
   * P64: the project's last session of this CLI the dock may resume (24 h, at least one prompt, transcript present; Codex only
   * with today's rules), from the session log. The launcher checks the id again before it resumes and falls back to fresh.
   */
  function lastSession(slug: string, cli: "claude" | "codex"): ResumeChoice {
    try {
      return chooseResume(logStoreOf(o.paths), {
        project: slug,
        cli,
        now: o.now?.() ?? new Date(),
        ...(cli === "codex" ? { within: codexHome(o.paths, slug), instructions: sessionInstructions(o.paths.home, o.paths.projects, slug) } : {}),
      });
    } catch {
      return { session: null, why: null }; // an unreadable log: start fresh, as before P64
    }
  }

  /** One `ensure` per project at a time: two admin tabs opening the column at once get the same session (P57 2d). */
  const ensuring = new Map<string, Promise<{ session: TerminalSessionDto; created: boolean; why: string | null }>>();
  function ensure(project: string | undefined, theme?: "light" | "dark") {
    const key = project ?? "";
    const known = ensuring.get(key);
    if (known) return known.then((r) => ({ ...r, created: false }));
    const p = (async () => {
      const slug = project ?? null;
      if (slug && (await o.repos.projects.get(slug)) === null) throw new TerminalRefusal(404, `no project "${slug}"`);
      const running = manager?.list().find((s) => s.state === "running" && s.project === slug);
      if (running) return { session: running, created: false, why: null };
      const { facts } = await detector.get();
      const pick = pickPreset(facts, features().agent.default, !!slug);
      const choice: ResumeChoice = pick.preset !== "shell" && slug ? lastSession(slug, pick.preset) : { session: null, why: null };
      const said = choice.session ? resumedLine(choice.session, pick.preset as "claude" | "codex") : choice.why ? `Not resumed: ${choice.why}. A fresh session.` : null;
      return { session: await create(pick.preset, project, theme, choice.session?.session), created: true, why: pick.why ?? said };
    })().finally(() => ensuring.delete(key));
    ensuring.set(key, p);
    return p;
  }

  const wss = terminalSocketServer();
  const refuse = (socket: Duplex, status: number, text: string) => {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  /** The Node server's `upgrade` event. Every check runs before `handleUpgrade`, in plain code. */
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== TERMINAL_PATH || !features().terminal.enabled) return refuse(socket, 404, "Not Found");
    if (url.search) return refuse(socket, 400, "Bad Request"); // the ticket is the first frame, never in the URL (it would be logged)
    const why = gateRefusal({ origin: req.headers.origin, host: req.headers.host }, o.adminPort, { sameSite: false });
    if (why) return refuse(socket, 403, "Forbidden");
    wss.accept(req, socket, head, { manager: sessions(), redeem: (t) => { const s = tickets.redeem(t); return s?.startsWith("term:") ? s.slice(5) : null; } });
  }

  return {
    enabled: () => features().terminal.enabled,
    state: () => {
      const d = detector.peek();
      return { enabled: true as const, unattended: features().agent.unattended, presets: presetOrder(features().agent.default, true), sessions: manager?.list() ?? [], clis: (d?.facts ?? []).map(wireFact), checkedAt: d?.at ?? null };
    },
    create,
    ensure,
    /** Server start, with the terminal on: detect in the background so the first open does not wait (nobody waits on this). */
    warm: () => { if (features().terminal.enabled) void detector.get(); },
    detector,
    close: (id: string) => manager?.kill(id) ?? false,
    has: (id: string) => manager?.has(id) ?? false,
    ticket: (id: string) => ({ ...tickets.mint(`term:${id}`), url: `ws://127.0.0.1:${o.apiPort}${TERMINAL_PATH}` }),
    upgrade,
    stop: () => { manager?.killAll(); wss.close(); },
  };
}
export type TerminalService = ReturnType<typeof createTerminal>;
