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
import { nodePty, nodePtyRoot, presetArgv, presetOrder, SessionLimitError, sessionManager, sessionTitle, spawnLine, tabShell, terminalEnv, terminalReadiness, terminalSocketServer, type PtySpawn, type SessionManager, type TerminalProblem } from "@hub/terminal";
import { HubError } from "@hub/config/errors";
import { fakeMode } from "@hub/config/modes";
import { gateRefusal, ticketStore, type TicketStore } from "../http/admin-gate";
import { clearDrops, dropRefusal, removeDrop, writeDrop, type DroppedFile } from "./drops";
import { errFields, ops, currentAction } from "@hub/log/ops";
import { ACTION_ENV, newActionId } from "@hub/config/action-id";

// The embedded terminal's server side (P49 section 4, guards S1 to S7). Always on (decision 0032): no switch; the guards
// make it safe, not a switch. When no tab can start (P66, `terminalReadiness`), the state carries `problem` and a start is
// refused with 503 and the same fix line. The socket goes straight to this port (not through Next's `/api` rewrite) and
// opens only for the admin's exact origin with a single-use ticket.

export const TERMINAL_PATH = "/terminal";
/** A socket ticket lives 30 s (the page fetches one right before it connects). */
const TICKET_TTL_MS = 30_000;

export interface TerminalOptions {
  paths: HubPaths;
  repos: Repos;
  adminPort: number;
  apiPort: number;
  /** Tests: a fake PTY; default node-pty from the core, loaded on the first session only. */
  spawn?: PtySpawn;
  /**
   * Can a tab start (P66)? Default: `terminalReadiness` on the core with heal (it sets the helper's bit); with an injected
   * `spawn` (tests) always ready unless the test injects its own.
   */
  readiness?: () => TerminalProblem | null;
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
/** The folder of this server's own node is searched first: the plist pins it (P67), and `npm i -g` puts both CLIs there. */
export function serverDetector(o: { env: NodeJS.ProcessEnv; fake: boolean; nodeBin?: string }): CliDetector {
  const dirs = [path.dirname(o.nodeBin ?? process.execPath)];
  return cliDetector({ detect: o.fake ? async () => fakeFacts(MEASURED_VERSIONS) : () => detectClis({ env: o.env, dirs }) });
}

/** How long `ensure` waits for a detection before it picks from the last answer (or the config order): a request never waits on a login shell. */
export const ENSURE_DETECT_MS = 8_000;

/** The wire half of a fact: no path. */
const wireFact = ({ cli, state, version, detail, fix }: CliFactDto): CliFactDto => ({ cli, state, version, detail, fix });

const TERMINAL_KINDS = { 400: "invalid", 404: "not_found", 409: "wrong_state", 413: "invalid", 503: "unavailable" } as const;

/** The terminal route keeps its own mapping (`terminal_unavailable` with `fix`, 413 for a drop); `kind` is for every other surface. */
export class TerminalRefusal extends HubError {
  constructor(readonly status: 400 | 404 | 409 | 413 | 503, message: string, readonly fix: string | null = null) {
    super(TERMINAL_KINDS[status], "terminal_refusal", message);
    this.name = "TerminalRefusal";
  }
}

/** A failed readiness is rechecked at most this often (a state read, a start), so a fix lands without a restart. */
const RECHECK_MS = 5_000;

export function createTerminal(o: TerminalOptions) {
  const env = o.env ?? process.env;
  const nodeBin = o.nodeBin ?? process.execPath;
  const tickets = o.tickets ?? ticketStore({ ttlMs: TICKET_TTL_MS });
  const features = () => instanceFeatures(o.paths);
  const fake = o.fakeShell ?? fakeMode(env, "shell") === "fake";
  const detector = o.detector ?? serverDetector({ env, fake });
  const app = path.join(o.paths.core, "app");
  // The fake shell spawns node, not $SHELL: its check is node's own binary.
  const readiness = o.readiness ?? (o.spawn ? () => null : () => terminalReadiness({ app, shell: fake ? nodeBin : tabShell(env), heal: true }));
  let problem: TerminalProblem | null = null;
  let checkedAt = -Infinity;
  /** The last readiness; a problem is checked again after `RECHECK_MS` (`force`: Agent tools' Refresh, server start). */
  const currentProblem = (force = false): TerminalProblem | null => {
    const at = Date.now();
    if (force || (problem !== null && at - checkedAt >= RECHECK_MS) || checkedAt === -Infinity) {
      checkedAt = at;
      try { problem = readiness(); } catch (e) { problem = { reason: `the terminal check failed: ${e instanceof Error ? e.message : String(e)}`, fix: "hub doctor --only Agent" }; }
    }
    return problem;
  };
  const refuseIfProblem = () => {
    const p = currentProblem();
    if (p) throw new TerminalRefusal(503, `The terminal cannot start: ${p.reason}.`, p.fix);
  };
  let manager: SessionManager | null = null;
  // A session that ends may have been his `claude auth login`, `codex login` or an install: the next pick reads fresh facts.
  const sessions = (): SessionManager => (manager ??= sessionManager({ spawn: o.spawn ?? nodePty(nodePtyRoot(app)), onExit: (d) => {
    // P86: a session that ended with an error code is a line (Claude Code or Codex failed to start or died); a clean exit says nothing.
    if (d.exitCode !== null && d.exitCode !== 0) ops("agent").warn("a terminal session ended with an error", { project: d.project, preset: d.preset, status: d.exitCode });
    else ops("agent").info("agent session stopped", { project: d.project, preset: d.preset, status: d.exitCode });
    void detector.refresh();
  } }));

  /** `resume`: a session id from the log (P64, `ensure` only); the `+` menu never passes one, so it always starts fresh. */
  async function create(preset: TerminalPreset, project: string | undefined, theme?: "light" | "dark", resume?: string) {
    const slug = project ?? null;
    if (slug && (await o.repos.projects.get(slug)) === null) throw new TerminalRefusal(404, `no project "${slug}"`);
    refuseIfProblem();
    if (!presetOrder(features().agent.default, !!slug).includes(preset)) throw new TerminalRefusal(400, `${preset} needs a project in the address`);
    const argv = presetArgv(preset, slug, { nodeBin, hubBin: o.paths.hubBin, resume });
    // The fake shell gets the agent's argv after `--exec` and prints it, so tests see exactly what would run.
    const shell = fake
      ? { file: nodeBin, args: [path.join(o.paths.core, "app", "test-support", "fake-shell.mjs"), ...(argv ? ["--exec", ...argv] : [])] }
      : spawnLine(env.SHELL?.trim() || "/bin/zsh", argv);
    // P137 L1: the session carries the click that opened it (`HUB_ACTION`): its hooks and `hub mcp` tool calls log under it.
    const action = currentAction() ?? newActionId("s");
    try {
      const created = sessions().create({
        preset,
        project: slug,
        title: sessionTitle(preset, slug, !!resume),
        ...shell,
        cwd: o.paths.home,
        env: { ...terminalEnv({ base: env, home: o.paths.home, project: slug, nodeBin, theme }), [ACTION_ENV]: action },
      });
      ops("agent").info("agent session started", { project: slug, preset, resumed: !!resume });
      return created;
    } catch (e) {
      if (e instanceof SessionLimitError) throw new TerminalRefusal(409, e.message);
      ops("agent").error("a terminal session did not start", { project: slug, preset, ...errFields(e, true) });
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

  /** The detection if it lands within `ms`, else the last answer (null before the first: `pickPreset` then keeps the config order). */
  const factsWithin = async (ms: number) => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); timer.unref?.(); });
    try {
      const d = await Promise.race([detector.get(), late]);
      return (d ?? detector.peek())?.facts ?? null;
    } finally {
      clearTimeout(timer);
    }
  };

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
      refuseIfProblem();
      const facts = await factsWithin(ENSURE_DETECT_MS);
      const pick = pickPreset(facts, features().agent.default, !!slug);
      const choice: ResumeChoice = pick.preset !== "shell" && slug ? lastSession(slug, pick.preset) : { session: null, why: null };
      const said = choice.session ? resumedLine(choice.session, pick.preset as "claude" | "codex") : choice.why ? `Not resumed: ${choice.why}. A fresh session.` : null;
      return { session: await create(pick.preset, project, theme, choice.session?.session), created: true, why: [pick.why, said].filter(Boolean).join(" · ") || null };
    })().finally(() => ensuring.delete(key));
    ensuring.set(key, p);
    return p;
  }

  /**
   * P76, decision 0041: files dropped on a running session's tab, written under `state/drops/<project>/<session>/`; the
   * absolute paths, in order. The pane pastes them; the server types nothing.
   */
  function drop(id: string, files: readonly DroppedFile[]): string[] {
    const s = manager?.list().find((x) => x.id === id);
    if (!s) throw new TerminalRefusal(404, "terminal session not found");
    if (s.state !== "running") throw new TerminalRefusal(409, "the program in this tab has ended: nothing is pasted");
    const no = dropRefusal(files.map((f) => ({ size: f.bytes.byteLength })));
    if (no) throw new TerminalRefusal(no.status, no.message);
    return writeDrop(o.paths, s.project, id, files);
  }

  const wss = terminalSocketServer();
  const refuse = (socket: Duplex, status: number, text: string) => {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  /** The Node server's `upgrade` event. Every check runs before `handleUpgrade`, in plain code. */
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== TERMINAL_PATH) return refuse(socket, 404, "Not Found");
    if (url.search) return refuse(socket, 400, "Bad Request"); // the ticket is the first frame, never in the URL (it would be logged)
    const why = gateRefusal({ origin: req.headers.origin, host: req.headers.host }, o.adminPort, { sameSite: false });
    if (why) return refuse(socket, 403, "Forbidden");
    wss.accept(req, socket, head, { manager: sessions(), redeem: (t) => { const s = tickets.redeem(t); return s?.startsWith("term:") ? s.slice(5) : null; } });
  }

  return {
    state: () => {
      const d = detector.peek();
      // Never waits: no answer yet, or one with an `unknown` CLI (a slow start), starts one detection in the background
      // (single flight, only once the answer is stale), so it is replaced without a session having to end first. A
      // `missing` or `signed-out` answer is left to the other triggers (a session ending, Refresh, `ensure`): re-detecting
      // it every minute would run the owner's login shell every minute the admin is open.
      if (!d || d.facts.some((f) => f.state === "unknown")) void detector.get();
      return { unattended: features().agent.unattended, presets: presetOrder(features().agent.default, true), sessions: manager?.list() ?? [], clis: (d?.facts ?? []).map(wireFact), checkedAt: d?.at ?? null, problem: currentProblem() };
    },
    /** Why no tab can start, checked now (server start, Agent tools' Refresh); null when a tab can start. */
    recheck: () => currentProblem(true),
    create,
    ensure,
    /** Server start: empty `state/drops` (P76: no session survives a restart), check readiness (it sets the helper's bit), then detect in the background so the first open does not wait. */
    warm: (): TerminalProblem | null => {
      clearDrops(o.paths);
      const p = currentProblem(true);
      void detector.get();
      return p;
    },
    detector,
    /** Ends the session and removes its drop folder (P76). */
    close: (id: string) => {
      const s = manager?.list().find((x) => x.id === id);
      const killed = manager?.kill(id) ?? false;
      if (s) removeDrop(o.paths, s.project, id);
      return killed;
    },
    drop,
    has: (id: string) => manager?.has(id) ?? false,
    ticket: (id: string) => ({ ...tickets.mint(`term:${id}`), url: `ws://127.0.0.1:${o.apiPort}${TERMINAL_PATH}` }),
    upgrade,
    stop: () => { manager?.killAll(); wss.close(); clearDrops(o.paths); },
  };
}
export type TerminalService = ReturnType<typeof createTerminal>;
