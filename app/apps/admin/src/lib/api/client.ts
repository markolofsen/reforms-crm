import { QueryClient } from "@tanstack/react-query";
import { parseApiError, type ApiErrorCode } from "@hub/contract/errors";

/** A refusal or a failure, with the sentence to show and the code to decide on. */
export class ApiFailure extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** The whole list of reasons when a send was refused; empty otherwise. */
  readonly refused: string[];
  constructor(message: string, code: ApiErrorCode, status: number, refused: string[] = []) {
    super(message);
    this.name = "ApiFailure";
    this.code = code;
    this.status = status;
    this.refused = refused;
  }
}

// Structural, so the admin needs no zod of its own: every contract schema has this `safeParse`.
type Parser<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };
type Scalar = string | number | boolean | undefined;
export type Call = { method: "GET" | "POST" | "PUT"; path: string; query?: Record<string, Scalar>; body?: unknown };

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 } },
});

const BUSY_RETRY_MS = 400;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function urlOf(call: Call): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(call.query ?? {})) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s ? `${call.path}?${s}` : call.path;
}

async function send(call: Call): Promise<Response> {
  try {
    return await fetch(urlOf(call), {
      method: call.method,
      headers: call.body === undefined ? undefined : { "content-type": "application/json" },
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
    });
  } catch {
    throw new ApiFailure("Cannot reach the local server. Is it running? Start it with `hub up`.", "server", 0);
  }
}

/**
 * The one place the admin talks to the server: sends the call, retries once when the database is busy (503), turns a
 * refusal into an `ApiFailure` carrying the server's own sentence, and parses a success with the contract schema, so
 * a stale server fails with a sentence instead of a render crash.
 */
export async function read<T>(schema: Parser<T>, call: Call): Promise<T> {
  let res = await send(call);
  if (res.status === 503) {
    await wait(BUSY_RETRY_MS);
    res = await send(call);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = parseApiError(body, res.status);
    throw new ApiFailure(e.error, e.code, res.status, e.refused);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiFailure("The server answered in a shape this page does not know. Restart the server with `hub up`.", "server", res.status);
  return parsed.data;
}

/** The sentence for any thrown value. */
export const sentence = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");

/** Reads of Mail (an `osascript` call each): the draft as Mail holds it, and a client's thread. */
const MAIL_KEYS: readonly unknown[] = ["draft-mail", "thread"];

/**
 * After a write (or a changed database file) every list but the pulse is read again. Mail is read again only when the
 * draft's status changed, a check was understood (the checks come with the Mail read) or it was sent (`mail: true`): a tone, a switch or a mark does not change what Mail holds, and
 * the server compares the text's hash again at send, so a cached read can never send other text than the person saw.
 */
export const refreshData = (qc: QueryClient, { mail = false }: { mail?: boolean } = {}) =>
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "pulse" && (mail || !MAIL_KEYS.includes(q.queryKey[0])) });
