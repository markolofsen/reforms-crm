import { z } from "zod";

/**
 * Whether this Mac starts the Hub's server at login (P67, decision 0033): one LaunchAgent per instance, read and switched by
 * `GET` and `POST /api/instance/autostart`. The label comes from the instance on the server, never from a request. The server
 * never writes or removes the agent: `installed: false` carries the installer's fix line.
 */
export const autostartDto = z.strictObject({
  /** macOS: false elsewhere, and the admin shows no row. */
  supported: z.boolean(),
  label: z.string(),
  /** The plist exists in `~/Library/LaunchAgents`. */
  installed: z.boolean(),
  /** Not switched off (`launchctl disable` and the off file). */
  enabled: z.boolean(),
  loaded: z.boolean(),
  /** launchd runs the job now. */
  running: z.boolean(),
  /** How THIS server was started: by the agent at login (`HUB_AUTOSTART=1`) or by hand. */
  startedBy: z.enum(["launchd", "hand"]),
  /** The last time the agent ran (a start, a stand-by beside a hand-run, or the off file seen). */
  lastStart: z.strictObject({ at: z.string(), event: z.enum(["start", "standby", "off"]) }).nullable(),
  /** Five failed starts in 15 minutes stopped it until the next login or `./run.sh restart`. */
  guard: z.strictObject({ at: z.string(), error: z.string() }).nullable(),
  /** mail-mcp (the agent session's Mail) answers on :8787; null when not asked (autostart off, or not macOS). */
  mailMcp: z.boolean().nullable(),
  /** The installer's line when something is not set up; null otherwise. */
  fix: z.string().nullable(),
});
export type AutostartDto = z.infer<typeof autostartDto>;

/** The switch. Strict: a `label` or any other field is refused (the label is the server's). */
export const setAutostartBody = z.strictObject({ enabled: z.boolean() });
export type SetAutostartBody = z.infer<typeof setAutostartBody>;
