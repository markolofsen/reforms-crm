import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { CLOSE, parseClientFrame, type ServerFrame } from "@hub/contract/terminal";
import type { SessionManager, Viewer } from "./sessions";

// One terminal socket, after the server's upgrade checks (flag, Host, exact Origin). Nothing of the PTY flows before a
// valid `{op: "auth", ticket}` arrives as the first frame, within `authMs`; the ticket names the session.

export interface SocketDeps {
  manager: SessionManager;
  /** Spends a ticket; returns the session it was minted for, or null. */
  redeem: (ticket: string) => string | null;
  authMs?: number;
  pingMs?: number;
}

const viewerOf = (ws: WebSocket): Viewer => ({
  sendText: (f: ServerFrame) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(f)); },
  sendBinary: (d: Buffer) => { if (ws.readyState === ws.OPEN) ws.send(d, { binary: true }); },
  bufferedAmount: () => ws.bufferedAmount,
  close: (code, reason) => ws.close(code, reason),
});

export function serveTerminalSocket(ws: WebSocket, d: SocketDeps): void {
  let session: string | null = null;
  let detach: (() => void) | null = null;
  const authTimer = setTimeout(() => { if (!session) ws.close(CLOSE.unauthorized, "no ticket"); }, d.authMs ?? 2000);
  const ping = setInterval(() => { if (ws.readyState === ws.OPEN) ws.ping(); }, d.pingMs ?? 20_000);
  ping.unref?.();

  ws.on("message", (raw, isBinary) => {
    if (!session) {
      const f = isBinary ? null : parseClientFrame(raw.toString());
      const id = f?.op === "auth" ? d.redeem(f.ticket) : null;
      if (!id || !d.manager.has(id)) { ws.close(id ? CLOSE.notFound : CLOSE.unauthorized, id ? "no such session" : "bad ticket"); return; }
      session = id;
      clearTimeout(authTimer);
      void d.manager.attach(id, viewerOf(ws)).then((off) => {
        if (!off) ws.close(CLOSE.notFound, "no such session");
        else if (ws.readyState !== ws.OPEN) off();
        else detach = off;
      });
      return;
    }
    if (isBinary) { d.manager.input(session, raw.toString()); return; }
    const f = parseClientFrame(raw.toString());
    if (f?.op === "resize") d.manager.resize(session, f.cols, f.rows);
    else if (f?.op === "ping" && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op: "pong" } satisfies ServerFrame));
  });
  ws.on("close", () => {
    clearTimeout(authTimer);
    clearInterval(ping);
    detach?.();
  });
}

/** The `ws` server without a listener of its own: the API server's `upgrade` event hands it a request that passed its checks. */
export function terminalSocketServer(o: { maxPayload?: number } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: o.maxPayload ?? 1_048_576 });
  return {
    accept: (req: IncomingMessage, socket: Duplex, head: Buffer, d: SocketDeps) => wss.handleUpgrade(req, socket, head, (ws) => serveTerminalSocket(ws, d)),
    close: () => wss.close(),
  };
}
