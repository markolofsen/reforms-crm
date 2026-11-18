// Every request the `Leads` rows send (P46): its own timeout, one retry on a network failure, the real error and the real time.
// Before 0.12.3 one 5 s AbortSignal covered the whole form: the page, up to 60 script chunks and the endpoint. A page that took 2 s with
// 35 chunks spent the budget, so the endpoint GET started on an aborted signal and the row said "endpoint unreachable: no answer within
// 5 s" after 0.0 s, while the endpoint answered in 1.5 s. Now each request has its own budget and the form a ceiling.

/** Tunable in tests only. `requestMs`: one attempt of one request; `formMs`: the whole form (both halves, every request). */
export const limits = { requestMs: 5000, formMs: 25_000 };

export interface Answer { status: number; headers: Headers; url: string; redirected: boolean; text: string; ms: number; attempts: number }

/** A request that failed twice (or hit the form's ceiling). The message is what a person reads in the row. */
export class NetError extends Error {
  constructor(message: string, readonly ms: number, readonly attempts: number) { super(message); this.name = "NetError"; }
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** What a thrown fetch error was, in words: our timeout, the form ceiling, or the network's own code and message. */
export function describe(e: unknown, deadline?: AbortSignal): string {
  if (deadline?.aborted) return `the form's ${limits.formMs / 1000} s ceiling was reached`;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return `no answer within ${limits.requestMs / 1000} s`;
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause as { code?: string; message?: string } | undefined;
  const code = cause?.code ? `${cause.code}: ` : "";
  const why = cause?.message && cause.message !== e.message ? `${code}${cause.message}` : code.replace(/: $/, "");
  return why ? `${e.message} (${why})` : e.message;
}

/**
 * One request with its own `limits.requestMs`, inside the form's `deadline`. The body is read inside the attempt (`body: false` cancels it),
 * so a stalled body counts as the timeout it is. A thrown error (timeout, reset, DNS) is retried once; an HTTP status is an answer and
 * never retried. Throws {@link NetError} naming both attempts and the time they took.
 */
export async function request(fetchFn: typeof fetch, url: string, init: RequestInit, deadline: AbortSignal, o: { body?: boolean } = {}): Promise<Answer> {
  const t0 = Date.now();
  const errors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (deadline.aborted) break;
    try {
      const signal = AbortSignal.any([deadline, AbortSignal.timeout(limits.requestMs)]);
      const r = await fetchFn(url, { ...init, signal });
      let text = "";
      if (o.body === false) void r.body?.cancel().catch(() => {});
      else text = await r.text();
      return { status: r.status, headers: r.headers, url: r.url, redirected: r.redirected, text, ms: Date.now() - t0, attempts: attempt };
    } catch (e) {
      errors.push(describe(e, deadline));
    }
  }
  const ms = Date.now() - t0;
  if (!errors.length) errors.push(describe(undefined, deadline));
  const said = errors.length === 2 && errors[0] === errors[1] ? `${errors[0]}, twice` : errors.length === 2 ? `${errors[0]}; retry: ${errors[1]}` : errors[0]!;
  throw new NetError(`${said} (${errors.length} attempt${errors.length > 1 ? "s" : ""}, ${secs(ms)})`, ms, errors.length);
}

export const errText = (e: unknown): string => (e instanceof NetError ? e.message : describe(e));
