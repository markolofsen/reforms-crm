import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Risk R3 (a page that bakes in build-time data or cannot build without the API): `next build` is run here with NO server
// listening on the API port and into its own directory. It must pass, and every route of the report must be dynamic.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("next build passes with the API stopped, and no route is prerendered with data", async () => {
  test.setTimeout(420_000);
  const run = spawnSync("pnpm", ["exec", "next", "build"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 400_000,
    // 1 is never an open port: the build must not need the API.
    env: { ...process.env, HUB_PORT: "1", HUB_NEXT_DIST: ".next-build-check", NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  const out = `${run.stdout}\n${run.stderr}`;
  expect(run.status, out).toBe(0);
  const routes = out.split("\n").filter((l) => /^[├└┌]/.test(l));
  expect(routes.length).toBeGreaterThanOrEqual(7);
  // `○` marks a static route and `●` an SSG one; `ƒ` is on demand. Only the framework's own not-found and the favicon file may be static.
  expect(routes.filter((l) => /^[├└┌] [○●]/.test(l) && !l.includes("/_not-found") && !l.includes("/icon.svg")), out).toEqual([]);
  expect(out).not.toMatch(/ECONNREFUSED/);
});
