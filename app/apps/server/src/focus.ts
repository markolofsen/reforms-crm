import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FocusInput, FocusPost, FocusRecord } from "@hub/contract/focus";

/**
 * The shared focus (P51, decision 0029): the last focus the owner's admin published, kept in memory and in `state/focus.json`
 * (ids only, no mail text, no secret) for `hub focus` and `hub mcp` to read. One file per instance. The rules:
 * - the last post of a visible tab wins (the publisher posts on window focus);
 * - a hidden post replaces only its own tab's focus, never a visible tab's;
 * - a clear removes only its own tab's focus;
 * - an unchanged post writes nothing (the heartbeat moves only `at`, kept in memory and written once a minute at most).
 */
export interface FocusStore {
  post(input: FocusInput): void;
  current(): FocusRecord | null;
}

const HEARTBEAT_WRITE_MS = 50_000;

export function createFocusStore(o: { file: string; now?: () => Date }): FocusStore {
  const now = o.now ?? (() => new Date());
  let last: FocusRecord | null = null;
  let writtenAt = 0;

  const write = (rec: FocusRecord | null) => {
    try {
      if (!rec) {
        rmSync(o.file, { force: true });
        return;
      }
      mkdirSync(path.dirname(o.file), { recursive: true });
      const tmp = `${o.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(rec) + "\n", { mode: 0o600 });
      renameSync(tmp, o.file);
      writtenAt = now().getTime();
    } catch {
      /* a focus that cannot be written leaves the agent without it; it must never fail the admin */
    }
  };
  const same = (a: FocusPost, b: FocusPost) => JSON.stringify(a) === JSON.stringify(b);

  return {
    post(input) {
      if ("clear" in input) {
        if (last && last.focus.tab === input.tab) {
          last = null;
          write(null);
        }
        return;
      }
      // A hidden tab never replaces another tab's visible focus.
      if (!input.visible && last && last.focus.tab !== input.tab && last.focus.visible) return;
      const at = now();
      const changed = !last || !same(last.focus, input);
      last = { schema: 1, at: at.toISOString(), focus: input };
      if (changed || at.getTime() - writtenAt >= HEARTBEAT_WRITE_MS) write(last);
    },
    current: () => last,
  };
}
