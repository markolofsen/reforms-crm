import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSendPolicy } from "./send-policy";
import { at, cardOf, contextWarn, remember } from "./support";

// P51 shared focus, end to end on the fake mailer: the admin publishes what it shows, `hub focus --hook` turns it into the
// prompt line, and a scripted agent (`test-support/fake-agent.mjs`: `focus`, `draft_show` over `hub mcp`, then
// the seeder of draft_write's writer with the same mailRef) revises the focused draft in place. Nothing is sent. Named z-* because it writes.
// P72: every route publishes its id and its own title; a clicked Knowledge row is `pointed`, and the scripted agent reads it
// with the tool the focus names (the hub's `knowledge_get`, P129 A4); `/log?client=N` names the client (P73); the file names nothing.

const hub = fileURLToPath(new URL("../../installer/bin/hub.mjs", import.meta.url));
// P129 A3: `hub record-draft` is gone (the agent records through draft_write); flows seed a draft row with the same writer.
const seedDraft = fileURLToPath(new URL("../../installer/test/support/seed-draft.mjs", import.meta.url));
const fakeAgent = fileURLToPath(new URL("../../../test-support/fake-agent.mjs", import.meta.url));
const projects = mkdtempSync(join(tmpdir(), "hub-e2e-focus-"));
cpSync(fileURLToPath(new URL("../../../packages/projects/test/fixtures/projects/acme-travel", import.meta.url)), join(projects, "demo-shop"), { recursive: true });
contextWarn(join(projects, "demo-shop", "project.md"));
writeSendPolicy(process.env.HUB_E2E_HOME ?? "", "demo-shop");
const env = { ...process.env, HUB_HOME: process.env.HUB_E2E_HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: projects, HUB_PROJECT: "demo-shop", NO_COLOR: "1" };
const focusFile = join(process.env.HUB_E2E_HOME ?? "", "state", "focus.json");
const run = (args: string[], input?: string) => execFileSync("node", args, { env, encoding: "utf8", ...(input ? { input } : {}) });
const record = (payload: object) => JSON.parse(run([seedDraft, "--project", "demo-shop"], JSON.stringify(payload))) as { ok: boolean; action: string; draftId: number; clientId: number };
type Disk = { at: string; focus: { tab: string; project: string | null; route: string; title: string; subject?: string; pointed?: string; window?: { refs: string[]; total: number } } };
const onDisk = () => (existsSync(focusFile) ? (JSON.parse(readFileSync(focusFile, "utf8")) as Disk) : null);
/** P99: the open conversation's client (`client:<id>`), whose unsent message is the focused draft. */
const clientOf = (d: Disk | null) => (d?.focus.subject?.startsWith("client:") ? Number(d.focus.subject.slice(7)) : undefined);
const sends = async (page: Page) => (await (await page.request.get("/api/projects/demo-shop/sends")).json()) as { sends: Array<{ draftId: number | null }> };

test("the focused draft is what the agent revises: same id, updated, nothing sent", async ({ page, context }) => {
  const fiona = record({ email: "fiona@example.com", name: "Fiona Focus", subject: "Re: Hello", mailRef: "<focus-1@example.com>", reason: "She asked how we are.", excerpt: "First version.", repliesOwed: true, skill: "triage-mail" });
  const gus = record({ email: "gus@example.com", name: "Gus Second", subject: "Re: Price", mailRef: "<focus-2@example.com>", reason: "A price question.", excerpt: "Hi Gus.", repliesOwed: true, skill: "triage-mail" });
  expect(fiona).toMatchObject({ ok: true, action: "created" });

  // 1. Opening draft 1 publishes it within a second; the file holds ids only.
  await remember(page, "demo-shop");
  await page.goto(at("demo-shop", `/mail/c/id-${fiona.clientId}?filter=all`));
  const card = cardOf(page, "Fiona Focus");
  await expect(card).toBeVisible();
  await expect.poll(() => clientOf(onDisk()), { timeout: 1500 }).toBe(fiona.clientId);
  expect(readFileSync(focusFile, "utf8")).not.toMatch(/Fiona|fiona@|Hello/);

  // 2. The prompt hook prints the line the model gets.
  const hook = JSON.parse(run([hub, "focus", "--hook"], "{}")) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  expect(hook.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  expect(hook.hookSpecificOutput.additionalContext).toMatch(new RegExp(`^\\[Hub focus, data\\] Conversation ${fiona.clientId} · open client:${fiona.clientId} "Fiona Focus <fiona@example.com> · draft ${fiona.draftId} ready[^"]*" draft ready \\(draft_show\\)`));

  // 3. "ответь этому клиенту": the scripted agent reads the focus and revises that draft.
  const agent = JSON.parse(run([fakeAgent, "I'm well, thanks — and the revised answer."])) as { tools: string[]; focused: number; recorded: { ok: boolean; action: string; draftId: number } };
  // P129 A3 client_record; A4 project_show (was project_notion, project_links), message_show (was inbound_show, mail_brand),
  // mail_list (was drafts_list) and the knowledge tools (were knowledge-mcp's).
  expect(agent.tools).toEqual(["client_record", "client_show", "draft_show", "draft_write", "focus", "highlight", "knowledge_get", "knowledge_search", "mail_list", "message_show", "messenger_draft_write", "messenger_history", "project_show"]);
  expect(agent.focused).toBe(fiona.draftId);
  expect(agent.recorded).toMatchObject({ ok: true, action: "updated", draftId: fiona.draftId });
  // The open card says so by itself (P50), and the list still has one Fiona.
  await expect(card.getByText("Changed by the agent since you opened it.")).toBeVisible({ timeout: 5000 });
  await card.getByRole("button", { name: "Reload" }).click();
  await expect(page.locator('ul[aria-label="People"] > li').filter({ hasText: "Fiona Focus" })).toHaveCount(1);
  // Nothing was sent: no send row for the draft (the fake Mailer's outbox is the sends table's other side).
  expect((await sends(page)).sends.filter((s) => s.draftId === fiona.draftId)).toEqual([]);

  // 4. A second tab focusing draft 2 wins; the first tab coming back wins again.
  const second = await context.newPage();
  await second.goto(at("demo-shop", `/mail/c/id-${gus.clientId}?filter=all`));
  await expect(cardOf(second, "Gus Second")).toBeVisible();
  await expect.poll(() => clientOf(onDisk()), { timeout: 1500 }).toBe(gus.clientId);

  // 5. A focus older than 10 minutes is stale: the hook adds nothing.
  const rec = onDisk();
  expect(rec).not.toBeNull();
  writeFileSync(focusFile, JSON.stringify({ ...rec, at: new Date(Date.parse(rec?.at ?? "") - 11 * 60_000).toISOString() }));
  expect(run([hub, "focus", "--hook"], "{}").trim()).toBe("");
  await second.close();
});

// P72: the knowledge base of the acme-travel fixture, indexed into demo-shop for this flow and removed afterwards (y-knowledge's way).
const APP = fileURLToPath(new URL("../../..", import.meta.url));
const SERVER_PROJECTS = process.env.HUB_E2E_PROJECTS ?? "";
const kbFolder = join(SERVER_PROJECTS, "demo-shop", "knowledge");
const indexKb = () => execFileSync("pnpm", ["--filter", "@hub/knowledge", "knowledge", "--root", SERVER_PROJECTS, "--db", process.env.HUB_E2E_DB ?? "", "index", "demo-shop"], { cwd: APP, stdio: "ignore", env: { ...process.env, HUB_HOME: process.env.HUB_E2E_HOME } });
const kbEnv = { ...env, HUB_PROJECTS: SERVER_PROJECTS };
const focusJson = () => JSON.parse(execFileSync("node", [hub, "focus", "--json"], { env: kbEnv, encoding: "utf8" })) as { state: string; route: string; title: string; subject: { ref: string; title: string } | null; pointed: { ref: string; title: string; read: { server: string; tool: string; args: Record<string, string> } } | null; window: { total: number } | null };

test("every screen says its own title; a clicked Knowledge row is what the agent reads, by the tool the focus names; the file names nothing", async ({ page }) => {
  cpSync(fileURLToPath(new URL("../../../packages/knowledge/test/fixtures/projects/acme-travel/knowledge", import.meta.url)), kbFolder, { recursive: true });
  indexKb();
  try {
    await remember(page, "demo-shop");
    // 1. Knowledge: a click on a row's title (not its Open) points it; the row is a Tab stop too.
    await page.goto(at("demo-shop", "/knowledge"));
    const table = page.getByRole("table", { name: "Knowledge entries" });
    const row = table.locator("tbody tr").nth(1);
    await expect(row).toBeVisible();
    const key = (await row.getAttribute("data-agent-ref")) ?? "";
    const title = ((await row.locator("td").first().textContent()) ?? "").trim();
    expect(key).toMatch(/^knowledge:knowledge\//);
    await row.locator("td").first().click();
    await expect.poll(() => onDisk()?.focus.pointed, { timeout: 2000 }).toBe(key);
    expect(onDisk()?.focus).toMatchObject({ route: "knowledge.page", title: "Knowledge" });
    expect(onDisk()?.focus.window?.total).toBeGreaterThan(5);
    // Ids only on disk: no entry title.
    expect(readFileSync(focusFile, "utf8")).not.toContain(title);
    // 2. What the agent gets: the entry by title, and how to read it.
    const f = focusJson();
    expect(f).toMatchObject({ state: "fresh", route: "knowledge.page", title: "Knowledge", pointed: { ref: key, title, read: { server: "hub", tool: "knowledge_get", args: { path: key.slice("knowledge:".length) } } } });
    const hook = JSON.parse(execFileSync("node", [hub, "focus", "--hook"], { env: kbEnv, input: "{}", encoding: "utf8" })) as { hookSpecificOutput: { additionalContext: string } };
    expect(hook.hookSpecificOutput.additionalContext).toMatch(/^\[Hub focus, data\] Knowledge · on knowledge:knowledge\/.* \(knowledge_get\) · \d+ of \d+ on screen/);
    // 3. "ответь по этой записи": the scripted agent reads the pointed entry with knowledge_get, never asking for a file name.
    const agent = JSON.parse(execFileSync("node", [fakeAgent, "--knowledge"], { env: kbEnv, encoding: "utf8" })) as { focus: { ref: string; entry: string }; got: { path: string; hasBody: boolean } };
    expect(agent.focus).toMatchObject({ ref: key, entry: title });
    expect(agent.got).toEqual({ path: key.slice("knowledge:".length), hasBody: true });
    // 4. Activity narrowed to one client names that client (P73); Settings, Help and Overview say their own titles.
    const client = ((await (await page.request.get("/api/activity?project=demo-shop")).json()) as { rows: Array<{ client: { id: number } | null }> }).rows.find((r) => r.client)?.client?.id;
    expect(client).toBeDefined();
    await page.goto(at("demo-shop", `/log?client=${client}`));
    await expect.poll(() => onDisk()?.focus.subject, { timeout: 2000 }).toBe(`client:${client}`);
    for (const [path, word] of [[at("demo-shop", "/settings"), "Sending"], [at("demo-shop", "/settings/mail"), "Mail"], [at("demo-shop", "/settings/agent"), "Agent"], ["/help", "Help"], ["/overview", "Overview"]] as const) {
      await page.goto(path);
      await expect.poll(() => onDisk()?.focus.title, { timeout: 2000 }).toBe(word);
    }
  } finally {
    rmSync(kbFolder, { recursive: true, force: true });
    indexKb();
  }
});
