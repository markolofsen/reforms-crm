import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import path from "node:path";
import { instanceFeatures, type HubPaths } from "@hub/config/paths";
import type { TerminalPreset } from "@hub/contract/terminal";
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
}

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
  let manager: SessionManager | null = null;
  const sessions = (): SessionManager => (manager ??= sessionManager({ spawn: o.spawn ?? nodePty() }));
  const features = () => instanceFeatures(o.paths);
  const fake = o.fakeShell ?? chooseShell(env) === "fake";

  async function create(preset: TerminalPreset, project: string | undefined, theme?: "light" | "dark") {
    const slug = project ?? null;
    if (slug && (await o.repos.projects.get(slug)) === null) throw new TerminalRefusal(404, `no project "${slug}"`);
    if (!presetOrder(features().agent.default, !!slug).includes(preset)) throw new TerminalRefusal(400, `${preset} needs a project in the address`);
    const argv = presetArgv(preset, slug, { nodeBin, hubBin: o.paths.hubBin });
    // The fake shell gets the agent's argv after `--exec` and prints it, so tests see exactly what would run.
    const shell = fake
      ? { file: nodeBin, args: [path.join(o.paths.core, "app", "test-support", "fake-shell.mjs"), ...(argv ? ["--exec", ...argv] : [])] }
      : spawnLine(env.SHELL?.trim() || "/bin/zsh", argv);
    try {
      return sessions().create({
        preset,
        project: slug,
        title: sessionTitle(preset, slug),
        ...shell,
        cwd: o.paths.home,
        env: terminalEnv({ base: env, home: o.paths.home, project: slug, nodeBin, theme }),
      });
    } catch (e) {
      if (e instanceof SessionLimitError) throw new TerminalRefusal(409, e.message);
      throw e;
    }
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
    state: () => ({ enabled: true as const, unattended: features().agent.unattended, presets: presetOrder(features().agent.default, true), sessions: manager?.list() ?? [] }),
    create,
    close: (id: string) => manager?.kill(id) ?? false,
    has: (id: string) => manager?.has(id) ?? false,
    ticket: (id: string) => ({ ...tickets.mint(`term:${id}`), url: `ws://127.0.0.1:${o.apiPort}${TERMINAL_PATH}` }),
    upgrade,
    stop: () => { manager?.killAll(); wss.close(); },
  };
}
export type TerminalService = ReturnType<typeof createTerminal>;
