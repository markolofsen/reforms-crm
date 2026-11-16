import { z } from "zod";

/**
 * Every refusal the API sends has this one shape, so the admin can show the sentence and decide on the code:
 * `invalid` a request the schema refuses (400), `not_found` (404), `wrong_state` the thing exists but the action does
 * not fit its state (409), `busy` the database is locked by another writer (503, retry once), `forbidden` a host the
 * loopback guard refuses (403), `server` anything unexpected (500).
 */
export const API_ERROR_CODES = ["invalid", "not_found", "wrong_state", "busy", "forbidden", "server"] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** `refused` is the whole list of reasons when a send is refused (409): the same strings `hub send` prints. */
export const apiError = z.object({ error: z.string(), code: z.enum(API_ERROR_CODES), refused: z.array(z.string()).optional() });
export type ApiError = z.infer<typeof apiError>;

const codeForStatus = (status: number): ApiErrorCode =>
  status === 404 ? "not_found" : status === 409 ? "wrong_state" : status === 503 ? "busy" : status === 403 ? "forbidden" : status >= 500 ? "server" : "invalid";

/** The refusal in a failed reply's body, or a plain one built from the status when the body is not ours (a proxy page). */
export function parseApiError(body: unknown, status: number): ApiError {
  const parsed = apiError.safeParse(body);
  if (parsed.success) return parsed.data.refused ? parsed.data : { error: parsed.data.error, code: parsed.data.code };
  // Older server answers carried `error` alone.
  const loose = z.object({ error: z.string() }).safeParse(body);
  if (loose.success) return { error: loose.data.error, code: codeForStatus(status) };
  return { error: `Request failed (${status})`, code: codeForStatus(status) };
}

/** A zod refusal as one sentence: the first issue with its path, e.g. `status: Invalid option`. */
export function sentenceOf(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (!issue) return "The request was refused.";
  const where = issue.path.map(String).join(".");
  return where ? `${where}: ${issue.message}` : issue.message;
}
