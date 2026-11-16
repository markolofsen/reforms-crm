export type Sleep = (ms: number) => Promise<void>;

/** A gate every request waits at: at most one request per `minIntervalMs`. Notion allows about 3 per second. */
export function createThrottle(
  minIntervalMs: number,
  now: () => number = Date.now,
  sleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
): () => Promise<void> {
  let next = 0;
  return async () => {
    const t = now();
    const wait = Math.max(0, next - t);
    next = Math.max(t, next) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  };
}
