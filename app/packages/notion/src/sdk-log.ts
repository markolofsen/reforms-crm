import notionhq from "@notionhq/client";
import { ops } from "@hub/log/ops";

// P137 L2: the Notion SDK's own log, into the ops log. The SDK retries a 429 (rate limit) and a 5xx itself; each retry is one
// `warn` line with its attempt and wait (never the request's path: it names a page). Its other lines are dropped: a failure is
// logged once by the caller that catches it (`notion.ts` `logged`, the writers' outcome lines), and the SDK's default logger would
// print to the console. Spread into every `new Client(...)` of this package.
export const notionSdkLog = {
  logLevel: notionhq.LogLevel.INFO,
  logger: (_level: unknown, message: string, extra: unknown): void => {
    if (message !== "retrying request") return;
    const attempt: unknown = extra && typeof extra === "object" ? Reflect.get(extra, "attempt") : undefined;
    const delayMs: unknown = extra && typeof extra === "object" ? Reflect.get(extra, "delayMs") : undefined;
    ops("notion").warn("Notion asked to wait (rate limit or overload); the request is retried", { attempt: typeof attempt === "number" ? attempt : null, delayMs: typeof delayMs === "number" ? delayMs : null });
  },
};
