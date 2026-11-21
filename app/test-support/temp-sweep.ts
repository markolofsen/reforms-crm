// Vitest globalSetup shared by every package with tests: before the run, removes the per-file temporary roots (`temp-root.ts`)
// that a killed run left behind. Only roots older than an hour, so a run of another package going on at the same time keeps its own.
import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PREFIX = "hub-t-";
const MAX_AGE_MS = 60 * 60_000;

export default function setup(): void {
  const dir = tmpdir();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const n of names) {
    if (!n.startsWith(PREFIX)) continue;
    const p = path.join(dir, n);
    try {
      if (now - statSync(p).mtimeMs > MAX_AGE_MS) rmSync(p, { recursive: true, force: true });
    } catch {
      // gone already, or not ours to remove
    }
  }
}
