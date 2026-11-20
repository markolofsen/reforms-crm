import { expect, test, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { at } from "./support";

// P59 F2 and S1 (P73: the sidebar's five rows are gone; the dot, the tones and the mute switch stay): the agent feed on the fake shell, from a log the test writes the way the hooks do (one JSON line
// per event under the instance's state/log). The server watches the folder and bumps the live topic `agent-log`; the admin
// refetches the feed. A fake AudioContext records which tone started (by its first pitch: 660 Hz attention, 784 ready, 523 problem).
const P = "lisbon-realty";
const HOME = process.env.HUB_E2E_HOME ?? "";
const dir = join(HOME, "state", "log", P);
let turn = 0;

function append(...events: Array<{ kind: string; data: Record<string, unknown>; corr?: string }>): void {
  mkdirSync(dir, { recursive: true });
  turn += 1;
  const now = new Date();
  const lines = events.map((e, i) => JSON.stringify({ v: 1, ts: new Date(now.getTime() + i).toISOString(), project: P, session: "e2e-sess-0001", cli: "claude", turn: `t${turn}`, ...(e.corr ? { corr: e.corr } : {}), kind: e.kind, data: e.data }));
  appendFileSync(join(dir, `${now.toISOString().slice(0, 10)}.jsonl`), lines.join("\n") + "\n");
}

const FAKE_AUDIO = () => {
  const w = window as unknown as { __tones: number[]; AudioContext: unknown };
  w.__tones = [];
  class Param { setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} }
  class Node { connect(n: unknown) { return n; } }
  class Osc extends Node { type = "sine"; frequency = { hz: 0, setValueAtTime: (v: number) => { (this.frequency.hz = v); } }; start() { w.__tones.push(this.frequency.hz); } stop() {} }
  class Gain extends Node { gain = new Param(); }
  w.AudioContext = class { state = "suspended"; currentTime = 0; destination = new Node(); async resume() { this.state = "running"; } async close() {} createOscillator() { return new Osc(); } createGain() { return new Gain(); } };
};

/** The tones that started, by the pitch each one opens with. */
const tones = (page: Page) => page.evaluate(() => (window as unknown as { __tones: number[] }).__tones.filter((hz) => hz === 660 || hz === 784 || hz === 523));

/** The next read of the feed (the live topic `agent-log` asked for it): the sync point after a line is appended. */
const fed = (page: Page) => page.waitForResponse((r) => r.url().includes("/agent-feed") && r.ok(), { timeout: 1_500 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(FAKE_AUDIO);
});

test("agent feed: the sidebar footer holds no feed rows (P73), and a line in the log adds none", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await expect(page.getByRole("button", { name: "Mute the agent sounds" })).toBeVisible();
  const read = fed(page);
  append({ kind: "tool_call", corr: "c1", data: { tool: "mcp__hub__draft_show", input: { draft: 1 } } }, { kind: "tool_result", corr: "c1", data: { tool: "mcp__hub__draft_show", output: "{}" } });
  await read;
  await expect(page.getByTestId("agent-feed")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Agent activity" })).toHaveCount(0);
  await expect(page.getByText("reads draft 1")).toHaveCount(0);
});

test("agent feed: a question turn sounds the attention tone once and turns the strip's dot; opening the column clears it", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await expect(page.getByRole("button", { name: "Mute the agent sounds" })).toBeVisible();
  await page.locator("#main").click({ position: { x: 5, y: 5 } }); // the gesture that lets audio start
  const routine = fed(page);
  append({ kind: "tool_call", corr: "c2", data: { tool: "Read", input: { file_path: "/x" } } }, { kind: "answer", data: { text: "Routine: draft 1 says hello." } });
  await routine;
  await page.waitForTimeout(2_000);
  expect(await tones(page)).toEqual([]);
  append({ kind: "answer", data: { text: "Which tone, formal or friendly?" } });
  await expect(page.locator('[data-testid="terminal-strip-dot"][data-attention]')).toBeVisible({ timeout: 1_500 });
  await expect(page.getByRole("button", { name: /the agent needs you/ })).toBeVisible();
  await expect.poll(() => tones(page), { timeout: 3_000 }).toEqual([660]);
  await page.getByRole("button", { name: /the agent needs you/ }).click();
  await expect(page.locator('[data-testid="terminal-strip-dot"][data-attention]')).toHaveCount(0);
});

test("agent feed: muted, a question turn plays nothing and the strip's dot still turns", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  const mute = page.getByRole("button", { name: "Mute the agent sounds" });
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  const asked = fed(page);
  append({ kind: "answer", data: { text: "Shall I send the price list?" } });
  await asked;
  await expect(page.locator('[data-testid="terminal-strip-dot"][data-attention]')).toBeVisible({ timeout: 1_500 });
  await page.waitForTimeout(2_500);
  expect(await tones(page)).toEqual([]);
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "false");
});

test("agent feed: of two tabs only one plays", async ({ page, context }) => {
  const other = await context.newPage();
  await other.addInitScript(FAKE_AUDIO);
  for (const p of [page, other]) {
    await p.goto(at(P, "/mail"));
    await expect(p.getByRole("button", { name: "Mute the agent sounds" })).toBeVisible();
    await p.locator("#main").click({ position: { x: 5, y: 5 } });
  }
  const failed = fed(page);
  append({ kind: "error", data: { source: "stop_failure", message: "overloaded" } });
  await failed;
  await page.waitForTimeout(2_500);
  const played = [...(await tones(page)), ...(await tones(other))];
  expect(played).toEqual([523]);
  await other.close();
});
