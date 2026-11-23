import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADMIN_PORT } from "@hub/config";
import type { Repos } from "@hub/db";
import { contexts } from "../../src/composition/contexts";
import { testRuntime } from "../support/runtime";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const repos = {} as Repos;
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith(".ts") && !n.endsWith(".test.ts") ? [join(d, n)] : []));

describe("P126 S1: one runtime, one context per domain", () => {
  it("cuts every domain's context from one runtime, with one admin port", () => {
    const ctx = contexts(testRuntime(repos));
    expect(Object.keys(ctx).sort()).toEqual(["agent", "instance", "live", "local", "mail", "messengers", "overview", "projects", "send", "terminal"]);
    for (const c of [ctx.agent, ctx.instance, ctx.local, ctx.messengers, ctx.terminal]) expect(c.adminPort).toBe(ADMIN_PORT);
    expect(ctx.mail.sender).toBeUndefined();
    expect(ctx.send.messengers).toBeUndefined();
  });
  it("takes the sender's port when a test names only that one", () => {
    const rt = testRuntime(repos, { sender: { kind: "fake", adminPort: 6001 } as never });
    expect(rt.adminPort).toBe(6001);
    expect(contexts(rt).terminal.adminPort).toBe(6001);
  });
  it("keeps the composition files small: app.ts and main.ts are wiring only", () => {
    expect(readFileSync(join(SRC, "app.ts"), "utf8").split("\n").length).toBeLessThanOrEqual(80);
    expect(readFileSync(join(SRC, "main.ts"), "utf8").split("\n").length).toBeLessThanOrEqual(60);
  });
  it("only composition, the start files and the test support read the runtime", () => {
    const readers = walk(SRC)
      .filter((f) => /from "[./]*\/?(composition\/)?runtime"/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).split("\\").join("/"))
      .filter((f) => !f.startsWith("composition/") && !f.endsWith("/start.ts") && !f.startsWith("test-support/"));
    expect(readers).toEqual(["app.ts"]);
  });
});
