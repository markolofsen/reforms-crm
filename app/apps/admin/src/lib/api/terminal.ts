import { okDto } from "@hub/contract/responses";
import { DROP_FIELD, ensureSessionDto, terminalDropDto, terminalSessionDto, terminalStateDto, terminalTicketDto, type CreateSessionBody, type EnsureSessionBody, type TerminalDropDto, type TerminalStateDto } from "@hub/contract/terminal";
import type { FocusPost } from "@hub/contract/focus";
import { pointerDto, type PointerDto } from "@hub/contract/pointer";
import { read } from "./client";

/** The resolved theme is the `.dark` class next-themes keeps on <html>: a new tab's CLI learns it through COLORFGBG. */
const theme = (): "light" | "dark" => (document.documentElement.classList.contains("dark") ? "dark" : "light");

/**
 * The embedded terminal's REST half (P49; the bytes go over the socket in `features/terminal/socket.ts`). Always on
 * (decision 0032): the state is one object; `problem` (P66) says why no tab can start, and a start is then refused (503).
 */
export const terminalApi = {
  /** The mode, the presets (default first), the sessions, the CLIs the server found and `problem`. */
  state: (): Promise<TerminalStateDto> => read(terminalStateDto, { method: "GET", path: "/api/terminal" }),
  /** A preset and the project of the admin URL (none: only `shell`); 409 at the cap of eight. */
  create: (body: CreateSessionBody) => read(terminalSessionDto, { method: "POST", path: "/api/terminal/sessions", body: { ...body, theme: theme() } }),
  /**
   * The column became visible (P57): the running session of this project, else the server starts its pick (the first ready
   * CLI). At most one session per project, even from two tabs at once. Not `+`: that is `create`.
   */
  ensure: (body: EnsureSessionBody) => read(ensureSessionDto, { method: "POST", path: "/api/terminal/ensure", body: { ...body, theme: theme() } }),
  /** Ends the session (its process group is killed). */
  close: (id: string) => read(okDto, { method: "DELETE", path: `/api/terminal/sessions/${encodeURIComponent(id)}` }),
  /**
   * P76, decision 0041: the files dropped on the tab, copied by the server under `state/drops/`; the answer is their absolute
   * paths in order, which the pane pastes. The caller checks `DROP_LIMITS` first (Next buffers the body in front of the server).
   */
  drop: (id: string, files: readonly File[]): Promise<TerminalDropDto> => {
    const form = new FormData();
    for (const f of files) form.append(DROP_FIELD, f, f.name);
    return read(terminalDropDto, { method: "POST", path: `/api/terminal/sessions/${encodeURIComponent(id)}/drops`, body: form });
  },
  /** A single-use ticket for one connect of the session's socket, and the socket's address (the API port, straight). */
  ticket: (session: string) => read(terminalTicketDto, { method: "POST", path: "/api/terminal/tickets", body: { session } }),
};

/**
 * The shared focus (P51): this tab tells the server what it shows, so the agent in the dock (or in Terminal.app) resolves
 * "this client" without asking. Here because it exists for the terminal's agent; the one module that calls `/api/focus`
 * (rules test). The server keeps the last visible tab's focus in `state/focus.json`; `clear` is this tab leaving.
 */
export const focusApi = {
  post: (focus: FocusPost) => read(okDto, { method: "POST", path: "/api/focus", body: focus }),
  /** On `pagehide`: `keepalive` lets the request outlive the page; same origin, so the exact-origin guard passes. Never throws. */
  clear: (tab: string): void => {
    try {
      void fetch("/api/focus", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ tab, clear: true }) }).catch(() => undefined);
    } catch {
      /* the page is going away */
    }
  },
};

/**
 * The agent's pointer (P72, decision 0038): what `highlight` in `hub mcp` asks to show, read when the live topic `pointer`
 * moves. Read only: the admin never writes the pointer; its outcome goes back in the next focus post.
 */
export const pointerApi = {
  get: (): Promise<PointerDto> => read(pointerDto, { method: "GET", path: "/api/pointer" }),
};
