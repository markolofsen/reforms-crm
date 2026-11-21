// Vitest setup file shared by every package with tests (listed first in its `setupFiles`): each test file gets its own temporary
// root, and `os.tmpdir()` answers it for the whole file (`TMPDIR`, read on every call; child processes inherit it). Every
// `mkdtemp(join(tmpdir(), ...))` of a test, a helper or the code under test lands inside it, and `afterAll` removes the root, so a
// test run leaves nothing in the OS temp folder (before this, ~15 000 folders and 2-3 GB of hub-* stayed behind).
// A run killed before `afterAll` leaves its root behind: `temp-sweep.ts` (globalSetup) removes roots older than an hour.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const saved = process.env.TMPDIR;
const root = mkdtempSync(path.join(tmpdir(), "hub-t-"));
process.env.TMPDIR = root;

afterAll(() => {
  if (saved === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = saved;
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});
