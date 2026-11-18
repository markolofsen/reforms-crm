import { okDto } from "@hub/contract/responses";
import { terminalSessionDto, terminalStateDto, terminalTicketDto, type CreateSessionBody, type TerminalStateDto } from "@hub/contract/terminal";
import { ApiFailure, read } from "./client";

/**
 * The embedded terminal's REST half (P49; the bytes go over the socket in `features/terminal/socket.ts`). The whole surface is
 * off when `terminal.enabled` is not true in the instance config: the state says `{enabled: false}` (an older server: 404) and the admin renders nothing.
 */
export const terminalApi = {
  /** The switch, the mode, the presets (default first) and the sessions; null when the terminal is off for this instance. */
  state: async (): Promise<TerminalStateDto | null> => {
    try {
      const s = await read(terminalStateDto, { method: "GET", path: "/api/terminal" });
      return s.enabled ? s : null;
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) return null;
      throw e;
    }
  },
  /** A preset and the project of the admin URL (none: only `shell`); 409 at the cap of eight. */
  // The resolved theme is the `.dark` class next-themes keeps on <html>: the new tab's CLI learns it through COLORFGBG.
  create: (body: CreateSessionBody) => read(terminalSessionDto, { method: "POST", path: "/api/terminal/sessions", body: { ...body, theme: document.documentElement.classList.contains("dark") ? "dark" : "light" } }),
  /** Ends the session (its process group is killed). */
  close: (id: string) => read(okDto, { method: "DELETE", path: `/api/terminal/sessions/${encodeURIComponent(id)}` }),
  /** A single-use ticket for one connect of the session's socket, and the socket's address (the API port, straight). */
  ticket: (session: string) => read(terminalTicketDto, { method: "POST", path: "/api/terminal/tickets", body: { session } }),
};
