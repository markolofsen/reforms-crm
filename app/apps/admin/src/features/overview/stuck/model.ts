import type { StuckClientDto } from "@hub/contract/client-map";

/**
 * P136 Q7 (verdict 7f): the words of one stuck node, pure: "Blocked" or "Waiting 9 days", from its state and since when (the
 * oldest version of the unbroken run, the server's). `now` comes from the clock.
 */
export function stuckWord(n: StuckClientDto["nodes"][number], now: number): string {
  if (n.state === "blocked") return "Blocked";
  const days = Math.max(0, Math.floor((now - Date.parse(n.since)) / 86_400_000));
  return `Waiting ${days === 1 ? "1 day" : `${days} days`}`;
}

/** How many clients are stuck across the projects read so far (the block's count). */
export const stuckTotal = (answers: ReadonlyArray<{ clients: readonly unknown[] } | undefined>): number => answers.reduce((n, a) => n + (a?.clients.length ?? 0), 0);
