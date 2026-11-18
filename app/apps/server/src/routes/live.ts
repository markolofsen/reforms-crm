import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { LiveService } from "../live";

/**
 * `GET /api/live` (P50): the same-origin SSE stream of invalidation events. It reads only, sets no CORS header (no other
 * origin can read it), and goes through the same Host guards as every route. The resume point is the browser's own
 * `Last-Event-ID` on a reconnect, or `?since=` when the page opens a new stream after the old one failed.
 */
export function liveRoutes(live: LiveService | undefined) {
  return new Hono().get("/api/live", (c) => {
    if (!live) return c.json({ error: "live updates are off", code: "not_found" as const }, 404);
    if (live.full()) return c.json({ error: "Too many live streams are open: close a tab of the admin.", code: "busy" as const }, 503);
    const lastId = c.req.header("last-event-id") ?? c.req.query("since");
    const res = streamSSE(c, async (stream) => {
      let done = () => {};
      const closed = new Promise<void>((resolve) => (done = resolve));
      const sub = live.subscribe({ send: (frame) => stream.write(frame).then(() => undefined), close: () => done() }, lastId);
      if (!sub) return;
      // Both: `onAbort` and the request's signal each fired on Node in the L0 spike, and either alone was reported flaky.
      stream.onAbort(() => done());
      c.req.raw.signal.addEventListener("abort", () => done(), { once: true });
      await closed;
      sub.unsubscribe();
    });
    // `no-transform` is load-bearing: without it Next's `/api` rewrite gzips the stream and holds every frame (L0 spike).
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("X-Accel-Buffering", "no");
    return new Response(res.body, { status: res.status, headers });
  });
}
