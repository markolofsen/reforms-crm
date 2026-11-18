import { CLOSE, serverFrame, type ClientFrame, type TerminalTicketDto } from "@hub/contract/terminal";
import { ApiFailure } from "@/lib/api/client";
import { terminalApi } from "@/lib/api/terminal";

// The one owner of a session's WebSocket (P49 section 4; it is not a fetch, so it does not go through `read`). Every connect
// fetches a fresh single-use ticket, opens the socket straight to the API port, sends `auth` first, and then reads `ready`,
// one binary snapshot of the screen so far, and the live stream. It reconnects after 1, 2, 5, then every 30 s, and stops
// for good when the session is gone or another window took it (until Take back).

/** Where a session's link stands, for the pane's one line. */
export type LinkState = { kind: "connecting" } | { kind: "live" } | { kind: "retrying"; inMs: number } | { kind: "taken" } | { kind: "gone" };

export type LinkEvents = {
  /** Bytes for the screen. `snapshot`: the screen and scrollback so far, so the screen is cleared before they are written. */
  output: (bytes: Uint8Array, snapshot: boolean) => void;
  exit: (code: number | null) => void;
  state: (s: LinkState) => void;
};

/** A socket as the link uses it; the browser's `WebSocket` behind {@link browserSocket}, a fake in `test/terminal-socket.test.ts`. */
export type SocketHandlers = { open: () => void; text: (data: string) => void; bytes: (data: Uint8Array) => void; close: (code: number) => void };
export type SocketLike = { send: (data: string | Uint8Array) => void; close: (code?: number) => void };
export type Timers = { set: (fn: () => void, ms: number) => number; clear: (id: number) => void };
export type LinkDeps = { ticket: (session: string) => Promise<TerminalTicketDto>; open: (url: string, on: SocketHandlers) => SocketLike; timers: Timers };

/** The waits between reconnects: 1, 2 and 5 s, then 30 s for as long as it takes. */
export const RETRY_MS = [1000, 2000, 5000, 30_000] as const;
export const retryDelay = (attempt: number): number => RETRY_MS[Math.min(Math.max(attempt, 0), RETRY_MS.length - 1)] ?? 30_000;
/** The client's own keepalive (the server pings too). */
export const PING_MS = 20_000;
/** Keystrokes typed while the link is down wait for it, up to this many chunks; older ones are dropped. */
const QUEUE_CAP = 256;

export function browserSocket(url: string, on: SocketHandlers): SocketLike {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => on.open();
  ws.onmessage = (ev: MessageEvent<unknown>) => {
    if (typeof ev.data === "string") on.text(ev.data);
    else if (ev.data instanceof ArrayBuffer) on.bytes(new Uint8Array(ev.data));
  };
  ws.onclose = (ev) => on.close(ev.code);
  return { send: (data) => ws.readyState === WebSocket.OPEN && ws.send(data), close: (code) => ws.close(code) };
}

const browserTimers: Timers = { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id) };
const browserDeps: LinkDeps = { ticket: terminalApi.ticket, open: browserSocket, timers: browserTimers };

export type Link = { input: (bytes: Uint8Array) => void; resize: (cols: number, rows: number) => void; takeBack: () => void; close: () => void };

/** Opens the link of one session and keeps it open until `close`. */
export function connectTerminal(session: string, on: LinkEvents, deps: LinkDeps = browserDeps): Link {
  let socket: SocketLike | null = null;
  let closed = false;
  let halted = false;
  /** The program ended: the screen stays as it was and a closed socket is not reopened. */
  let exited = false;
  let live = false;
  let snapshotNext = false;
  let attempt = 0;
  let retry: number | null = null;
  let ping: number | null = null;
  let size: { cols: number; rows: number } | null = null;
  const queue: Uint8Array[] = [];

  const control = (frame: ClientFrame) => live && socket?.send(JSON.stringify(frame));
  const stopTimers = () => {
    if (retry !== null) deps.timers.clear(retry);
    if (ping !== null) deps.timers.clear(ping);
    retry = ping = null;
  };
  const keepAlive = () => {
    ping = deps.timers.set(() => {
      control({ op: "ping" });
      keepAlive();
    }, PING_MS);
  };
  /** Ends the link without a retry: the session is gone, or another window holds it. */
  const halt = (kind: "taken" | "gone") => {
    halted = true;
    live = false;
    stopTimers();
    const s = socket;
    socket = null;
    s?.close(1000);
    on.state({ kind });
  };
  const schedule = () => {
    if (closed || halted) return;
    const inMs = retryDelay(attempt++);
    on.state({ kind: "retrying", inMs });
    retry = deps.timers.set(() => void connect(), inMs);
  };
  const onText = (text: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const frame = serverFrame.safeParse(parsed);
    if (!frame.success) return;
    const f = frame.data;
    if (f.op === "ready") {
      attempt = 0;
      live = true;
      snapshotNext = true;
      on.state({ kind: "live" });
      if (size) control({ op: "resize", ...size });
      for (const chunk of queue.splice(0)) socket?.send(chunk);
      keepAlive();
    } else if (f.op === "exit") {
      exited = true;
      on.exit(f.code);
    }
    else if (f.op === "taken") halt("taken");
  };

  async function connect(): Promise<void> {
    retry = null;
    if (closed || halted) return;
    on.state({ kind: "connecting" });
    let ticket: TerminalTicketDto;
    try {
      ticket = await deps.ticket(session);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) halt("gone");
      else schedule();
      return;
    }
    if (closed || halted) return;
    const s = deps.open(ticket.url, {
      open: () => s.send(JSON.stringify({ op: "auth", ticket: ticket.ticket } satisfies ClientFrame)),
      text: (t) => socket === s && onText(t),
      bytes: (b) => {
        if (socket !== s) return;
        on.output(b, snapshotNext);
        snapshotNext = false;
      },
      close: (code) => {
        if (socket !== s) return;
        socket = null;
        live = false;
        if (ping !== null) deps.timers.clear(ping);
        ping = null;
        if (closed || halted || exited) return;
        if (code === CLOSE.taken) halt("taken");
        else if (code === CLOSE.notFound) halt("gone");
        else schedule();
      },
    });
    socket = s;
  }

  void connect();
  return {
    input: (bytes) => {
      if (closed || halted || exited) return;
      if (live && socket) socket.send(bytes);
      else if (queue.push(bytes) > QUEUE_CAP) queue.shift();
    },
    resize: (cols, rows) => {
      size = { cols, rows };
      control({ op: "resize", cols, rows });
    },
    takeBack: () => {
      if (closed || !halted) return;
      halted = false;
      exited = false;
      attempt = 0;
      void connect();
    },
    close: () => {
      closed = true;
      live = false;
      stopTimers();
      const s = socket;
      socket = null;
      s?.close(1000);
    },
  };
}
