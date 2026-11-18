import { z } from "zod";

// The embedded terminal (P49, `@docs/core/24-terminal.md`). The browser names a preset and the project of its URL, never
// a command or a path; the server's preset table decides what runs. Every object is strict: an unknown field is refused.

/** What a new tab runs. `claude` and `codex` type `hub agent <slug> --cli <x>` into the shell; `shell` types nothing. */
export const TERMINAL_PRESETS = ["claude", "codex", "shell"] as const;
export type TerminalPreset = (typeof TERMINAL_PRESETS)[number];
export const PRESET_LABELS: Record<TerminalPreset, string> = { claude: "Claude Code", codex: "Codex", shell: "Shell" };

/** At most this many sessions run at once (a cap instead of idle reaping). */
export const MAX_SESSIONS = 8;
/** Columns and rows the server accepts; anything outside is clamped. */
export const TERMINAL_SIZE = { min: 2, max: 500 } as const;
export const clampSize = (n: number): number => Math.min(TERMINAL_SIZE.max, Math.max(TERMINAL_SIZE.min, Math.round(Number.isFinite(n) ? n : TERMINAL_SIZE.min)));

const slug = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(100);

export const terminalSessionDto = z.strictObject({
  id: z.string(),
  title: z.string(),
  preset: z.enum(TERMINAL_PRESETS),
  project: slug.nullable(),
  state: z.enum(["running", "exited"]),
  exitCode: z.number().int().nullable(),
  createdAt: z.string(),
});
export type TerminalSessionDto = z.infer<typeof terminalSessionDto>;

/** The terminal is on: the instance's mode for the tab badge, the presets in their order (default first), the sessions. */
export const terminalOnDto = z.strictObject({
  enabled: z.literal(true),
  unattended: z.boolean(),
  presets: z.array(z.enum(TERMINAL_PRESETS)),
  sessions: z.array(terminalSessionDto),
});
export type TerminalStateDto = z.infer<typeof terminalOnDto>;
/**
 * `GET /api/terminal`. Off (`terminal.enabled` not true) says only `{enabled: false}`: every other terminal route and the
 * socket are 404, so nothing is advertised; this one answers 200 so a page of an instance without the terminal logs no error.
 */
export const terminalStateDto = z.union([z.strictObject({ enabled: z.literal(false) }), terminalOnDto]);

/** `POST /api/terminal/sessions`: a preset and the project of the admin URL (none: only `shell`). */
/** `theme`: the admin's resolved theme when the tab starts, for `COLORFGBG` (a CLI that cannot query the terminal picks its palette from it). */
export const createSessionBody = z.strictObject({ preset: z.enum(TERMINAL_PRESETS), project: slug.optional(), theme: z.enum(["light", "dark"]).optional() });
export type CreateSessionBody = z.infer<typeof createSessionBody>;

/** `POST /api/terminal/tickets`: a single-use ticket for one session's socket, and where the socket is (the API port, straight). */
export const terminalTicketBody = z.strictObject({ session: z.string().min(1).max(100) });
export const terminalTicketDto = z.strictObject({ ticket: z.string(), expiresAt: z.string(), url: z.string() });
export type TerminalTicketDto = z.infer<typeof terminalTicketDto>;

/** Control frames on the socket, JSON text; terminal bytes go as binary frames both ways. */
export const clientFrame = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("auth"), ticket: z.string().min(1).max(200) }),
  z.strictObject({ op: z.literal("resize"), cols: z.number(), rows: z.number() }),
  z.strictObject({ op: z.literal("ping") }),
]);
export type ClientFrame = z.infer<typeof clientFrame>;

export const serverFrame = z.discriminatedUnion("op", [
  /** Auth accepted; a `snapshot` binary frame (the screen and scrollback so far) follows, then the live stream. */
  z.strictObject({ op: z.literal("ready"), session: z.string() }),
  z.strictObject({ op: z.literal("exit"), code: z.number().int().nullable() }),
  /** Another window took the session; this one shows "Opened in another window". */
  z.strictObject({ op: z.literal("taken") }),
  z.strictObject({ op: z.literal("pong") }),
]);
export type ServerFrame = z.infer<typeof serverFrame>;

/** WebSocket close codes the client reads. */
export const CLOSE = { unauthorized: 4401, notFound: 4404, taken: 4409 } as const;

/** `JSON.parse` + `clientFrame`; null for anything that is not one valid frame. */
export function parseClientFrame(text: string): ClientFrame | null {
  try {
    const r = clientFrame.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
