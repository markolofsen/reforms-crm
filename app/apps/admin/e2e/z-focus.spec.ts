import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSendPolicy } from "./send-policy";
import { at, cardOf, remember } from "./support";

// P51 shared focus, end to end on the fake mailer: the admin publishes what it shows, `hub focus --hook` turns it into the
// prompt line, and a scripted agent (`test-support/fake-agent.mjs`: `focus`, `draft_show` over `hub mcp`, then
// `hub record-draft` with the same mailRef) revises the focused draft in place. Nothing is sent. Named z-* because it writes.

const hub = fileURLToPath(new URL("../../installer/bin/hub.mjs", import.meta.url));
const fakeAgent = fileURLToPath(new URL("../../../test-support/fake-agent.mjs", import.meta.url));
const projects = mkdtempSync(join(tmpdir(), "hub-e2e-focus-"));
cpSync(fileURLToPath(new URL("../../../packages/projects/test/fixtures/projects/acme-travel", import.meta.url)), join(projects, "demo-shop"), { recursive: true });
writeSendPolicy(process.env.HUB_E2E_HOME ?? "", "demo-shop");
const env = { ...process.env, HUB_HOME: process.env.HUB_E2E_HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: projects, HUB_PROJECT: "demo-shop", NO_COLOR: "1" };
const focusFile = join(process.env.HUB_E2E_HOME ?? "", "state", "focus.json");
const run = (args: string[], input?: string) => execFileSync("node", args, { env, encoding: "utf8", ...(input ? { input } : {}) });
const record = (payload: object) => JSON.parse(run([hub, "record-draft", "--project", "demo-shop"], JSON.stringify(payload))) as { ok: boolean; action: string; draftId: number };
const onDisk = () => (existsSync(focusFile) ? (JSON.parse(readFileSync(focusFile, "utf8")) as { at: string; focus: { tab: string; draftId?: number; project: string } }) : null);
const sends = async (page: Page) => (await (await page.request.get("/api/projects/demo-shop/sends")).json()) as { sends: Array<{ draftId: number | null }> };

test("the focused draft is what the agent revises: same id, updated, nothing sent", async ({ page, context }) => {
  const fiona = record({ email: "fiona@example.com", name: "Fiona Focus", subject: "Re: Hello", mailRef: "<focus-1@example.com>", reason: "She asked how we are.", excerpt: "First version.", repliesOwed: true, skill: "triage-mail" });
  const gus = record({ email: "gus@example.com", name: "Gus Second", subject: "Re: Price", mailRef: "<focus-2@example.com>", reason: "A price question.", excerpt: "Hi Gus.", repliesOwed: true, skill: "triage-mail" });
  expect(fiona).toMatchObject({ ok: true, action: "created" });

  // 1. Opening draft 1 publishes it within a second; the file holds ids only.
  await remember(page, "demo-shop");
  await page.goto(at("demo-shop", `/drafts/${fiona.draftId}?filter=all`));
  const card = cardOf(page, "Fiona Focus");
  await expect(card).toBeVisible();
  await expect.poll(() => onDisk()?.focus.draftId, { timeout: 1500 }).toBe(fiona.draftId);
  expect(readFileSync(focusFile, "utf8")).not.toMatch(/Fiona|fiona@|Hello/);

  // 2. The prompt hook prints the line the model gets.
  const hook = JSON.parse(run([hub, "focus", "--hook"], "{}")) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  expect(hook.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  expect(hook.hookSpecificOutput.additionalContext).toMatch(new RegExp(`^\\[Hub focus, data\\] draft ${fiona.draftId} · Fiona Focus <fiona@example.com> · Re: Hello · ready`));

  // 3. "ответь этому клиенту": the scripted agent reads the focus and revises that draft.
  const agent = JSON.parse(run([fakeAgent, "I'm well, thanks — and the revised answer."])) as { tools: string[]; focused: number; recorded: { ok: boolean; action: string; draftId: number } };
  expect(agent.tools).toEqual(["client_show", "draft_show", "draft_write", "drafts_list", "focus"]);
  expect(agent.focused).toBe(fiona.draftId);
  expect(agent.recorded).toMatchObject({ ok: true, action: "updated", draftId: fiona.draftId });
  // The open card says so by itself (P50), and the list still has one Fiona.
  await expect(card.getByText("Changed by the agent since you opened it.")).toBeVisible({ timeout: 5000 });
  await card.getByRole("button", { name: "Reload" }).click();
  await expect(page.locator('ul[aria-label="Drafts"] > li').filter({ hasText: "Fiona Focus" })).toHaveCount(1);
  // Nothing was sent: no send row for the draft (the fake Mailer's outbox is the sends table's other side).
  expect((await sends(page)).sends.filter((s) => s.draftId === fiona.draftId)).toEqual([]);

  // 4. A second tab focusing draft 2 wins; the first tab coming back wins again.
  const second = await context.newPage();
  await second.goto(at("demo-shop", `/drafts/${gus.draftId}?filter=all`));
  await expect(cardOf(second, "Gus Second")).toBeVisible();
  await expect.poll(() => onDisk()?.focus.draftId, { timeout: 1500 }).toBe(gus.draftId);

  // 5. A focus older than 10 minutes is stale: the hook adds nothing.
  const rec = onDisk();
  expect(rec).not.toBeNull();
  writeFileSync(focusFile, JSON.stringify({ ...rec, at: new Date(Date.parse(rec?.at ?? "") - 11 * 60_000).toISOString() }));
  expect(run([hub, "focus", "--hook"], "{}").trim()).toBe("");
  await second.close();
});
