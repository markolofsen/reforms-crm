import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { coreUpdateDto, type CoreUpdateDto } from "@hub/contract/instance";
import { checkedLine, commandText, coreLine, factsLine } from "../src/features/settings/mac/core-labels";
import { CoreLine } from "../src/features/settings/mac/core-line";
import { CoreView } from "../src/features/settings/mac/core-view";
import { keys } from "../src/lib/cache/keys";

// The core line is an AppLink (P70): it reads the address and the router, which a static render has not mounted.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/mail", useSearchParams: () => new URLSearchParams() }));

// P68: the core version line in the sidebar and the block on Settings ▸ This Mac (P70; /health until then), for each level, from fixtures the server could send.

const NOW = Date.parse("2026-11-19T15:00:00Z");
const COMMAND = ["cd /x/saas && ./run.sh core update v0.12.12 --apply", 'git add core core.version && git commit -m "core: v0.12.12"', "./run.sh restart"];
const base: CoreUpdateDto = coreUpdateDto.parse({ pin: "v0.12.11", inUse: "v0.12.11", newest: "v0.12.11", level: "current", reason: "v0.12.11 is the newest release", tags: [], facts: { dependencies: false, migrations: false, rollback: false }, command: [], checkedAt: "2026-11-19T12:00:00.000Z" });
const avail: CoreUpdateDto = { ...base, level: "available", newest: "v0.12.12", reason: "1 newer release (patch); dependencies change", tags: [{ name: "v0.12.12", date: "2026-11-03T10:00:00+00:00", subject: "core: v0.12.12 (P64 resume)" }], facts: { dependencies: true, migrations: false, rollback: false }, command: COMMAND };
const at = (level: CoreUpdateDto["level"], over: Partial<CoreUpdateDto> = {}): CoreUpdateDto => ({ ...avail, level, ...over });

const line = (d: CoreUpdateDto) => {
  const qc = new QueryClient();
  qc.setQueryData(keys.core(), d);
  return renderToStaticMarkup(<QueryClientProvider client={qc}><CoreLine /></QueryClientProvider>);
};
const view = (d: CoreUpdateDto) => renderToStaticMarkup(<CoreView checking={false} d={d} now={NOW} onCheck={() => {}} said={null} />);

describe("the sidebar's core line", () => {
  it("current and unknown: the version only, no dot, a link to Settings ▸ This Mac", () => {
    for (const d of [base, at("unknown", { reason: "not checked yet", command: [] })]) {
      const html = line(d);
      expect(html).toContain("core v0.12.11");
      expect(html).toContain('href="/settings/mac"');
      expect(html).not.toContain("core-dot");
      expect(html).not.toContain("update");
    }
  });
  it("available: the plain words, no dot; recommended and required: the words and the dot", () => {
    expect(coreLine(avail)).toEqual({ text: "core v0.12.11", note: "update available", dot: false });
    expect(line(avail)).not.toContain("core-dot");
    for (const level of ["recommended", "required"] as const) {
      const html = line(at(level));
      expect(html).toContain('data-testid="core-dot"');
      expect(html).toContain(`update ${level}`);
    }
  });
  it("draws nothing before the server answered (the first render is the same on the server and in the browser)", () => {
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><CoreLine /></QueryClientProvider>);
    expect(html).toBe("");
  });
});

describe("the block on Settings ▸ This Mac", () => {
  it("an update: the level with its reason, the newer tag's subject, the facts and the exact command with its copy button", () => {
    const html = view(avail);
    expect(html).toContain("update available: 1 newer release (patch); dependencies change");
    expect(html).toContain("core: v0.12.12 (P64 resume)");
    expect(html).toContain("dependencies change.");
    expect(commandText(avail)).toBe(COMMAND.join("\n"));
    expect(html).toContain('aria-label="Copy the update command"');
    expect(html).toContain("./run.sh core update v0.12.12 --apply");
    expect(html).toContain("Check now");
  });
  it("current: no command, no list; when it was checked", () => {
    const html = view(base);
    expect(html).not.toContain("core-command");
    expect(html).not.toContain("Newer releases");
    expect(checkedLine(base, NOW)).toMatch(/^Last checked 3 h ago \(.+\)\.$/);
  });
  it("offline: the last answer stays and the line says when and why the check failed", () => {
    const d = at("available", { error: { at: "2026-11-19T14:00:00.000Z", message: "origin unreachable: Could not resolve host" } });
    expect(checkedLine(d, NOW)).toContain("; the check 1 h ago failed: origin unreachable: Could not resolve host");
    expect(view(d)).toContain("core: v0.12.12 (P64 resume)");
  });
  it("UX pass: a local checkout (hub core dev) is one quiet line, with no Check now and no facts", () => {
    const html = view(at("unknown", { local: true, inUse: null, reason: "core/ is a link to a local checkout (hub core dev): no update check" }));
    expect(html).toContain("Running a local checkout (development): no update check.");
    expect(html).not.toContain("Check now");
    expect(html).not.toContain("Newest tag");
  });

  it("P98: a local checkout names its own dev version, not the stale pin", () => {
    const d = at("unknown", { local: true, pin: "v0.13.0", inUse: "v0.14.0+13 (086c4e6)", reason: "core/ is a link to a local checkout (hub core dev): no update check" });
    expect(coreLine(d)).toEqual({ text: "core v0.14.0+13 (086c4e6)", note: "local checkout", dot: false });
    expect(view(d)).toContain("Running a local checkout (development), v0.14.0+13 (086c4e6): no update check.");
  });

  it("required, follows and rollback each say so", () => {
    expect(view(at("required", { reason: "v0.12.12 is marked [update: required]" }))).toContain("update required: v0.12.12 is marked [update: required]");
    expect(view(at("follows", { follows: { branch: "main", behind: 3 }, reason: "follows main: 3 commit(s) behind origin/main" }))).toContain("follows main");
    expect(factsLine(at("current", { facts: { dependencies: false, migrations: false, rollback: true } }))).toContain("rollback");
  });
});
