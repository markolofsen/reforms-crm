import { expect, type Locator, type Page } from "@playwright/test";

/** The address of the page as the person reads it: `/lisbon-realty/mail/c/42`. */
export const address = (page: Page) => page.evaluate(() => location.pathname + location.search);

/** A scoped address of the e2e instance, which has two projects: the project is the first path segment (P48). */
export const at = (project: string, path: string) => `/${encodeURIComponent(project)}${path}`;

/** The remembered project is the cookie `hub_project` (the shell writes it, a bare `/mail` reads it); a spec sets it before the first load. */
export const remember = (page: Page, slug: string) => page.context().addCookies([{ name: "hub_project", value: slug, domain: "127.0.0.1", path: "/" }]);

/** The people of the Mail list, in order (P99: a row is a person, a button for the conversation and a checkbox for the bulk mode). */
export const cards = (page: Page) => page.locator('ul[aria-label="People"] > li');
/** The one View menu of the Drafts list (its trigger reads "View: <view> <count>"). */
export const viewMenu = (page: Page) => page.getByRole("button", { name: /^View:/ });
/** The unsent message of one client (today's card body at the bottom of the conversation), once its row is open. */
export const cardOf = (page: Page, name: string): Locator => page.getByRole("article", { name: `Draft for ${name}` });

/** Opens the row of a client (a phone shows the card as its own screen; desktop shows it beside the list). */
export async function openRow(page: Page, name: string): Promise<Locator> {
  await cards(page).filter({ hasText: name }).getByRole("button").first().click();
  const card = cardOf(page, name);
  await expect(card).toBeVisible();
  return card;
}

/** Turns "I read the checks" on: understand each check first (the switch stays off until the red ones are), then the switch. */
export async function readTheChecks(page: Page) {
  for (const button of await page.getByRole("button", { name: /^Understood:/ }).all()) {
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  const sw = page.getByRole("switch", { name: "I read the checks" });
  if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
  await expect(sw).toBeChecked();
}

/** The one primary button of an open card that is not sending: named plain "Send". */
export const sendButton = (card: Locator) => card.getByRole("button", { name: "Send", exact: true });

/**
 * The open draft of the first person with one in the real list (P99: a row carries its one open draft; people who wrote have none), moved to the top so the wide pane opens it by itself, and patched: ready, Checked, no send
 * yet, unless the patch says otherwise. The rest of the answer is the server's own; the pane's own read of that person is patched
 * the same way. A function patch gets the draft and returns the fields to change (for a nested field such as the client).
 */
export async function firstDraftIs(page: Page, patch: Record<string, unknown> | ((d: Record<string, unknown>) => Record<string, unknown>)) {
  let firstId: unknown = null;
  const patched = (d: Record<string, unknown>) => {
    // No mark either: the newest-first order of P99 can put a do-not-contact client (Eve, Nuno) on top, whose card never offers Send.
    const base = { ...d, status: "ready", checked: true, batchId: null, sendState: null, injectionSuspected: false, client: { ...(d.client as object), marks: [] } };
    return { ...base, ...(typeof patch === "function" ? patch(base) : patch) };
  };
  await page.route(/\/api\/projects\/[^/]+\/conversations\?/, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { rows: Array<{ client: { id: unknown }; draft: Record<string, unknown> | null } & Record<string, unknown>> };
    const i = json.rows.findIndex((r) => r.draft);
    const first = json.rows[i];
    if (!first?.draft) return route.fulfill({ response: res, json });
    firstId = first.client.id;
    await route.fulfill({ response: res, json: { ...json, rows: [{ ...first, state: "draft", draft: patched(first.draft) }, ...json.rows.filter((_, n) => n !== i)] } });
  });
  await page.route(/\/api\/projects\/[^/]+\/clients\/\d+\/conversation$/, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { row: { client: { id: unknown }; draft: Record<string, unknown> | null } };
    if (json.row.client.id !== firstId || !json.row.draft) return route.fulfill({ response: res, json });
    await route.fulfill({ response: res, json: { ...json, row: { ...json.row, state: "draft", draft: patched(json.row.draft) } } });
  });
}

/** Patches the Mail read of every open draft (the rest of the answer is the fake Mailer's own). */
export async function mailIs(page: Page, patch: (mail: Record<string, unknown>) => Record<string, unknown>) {
  await page.route(/\/api\/projects\/[^/]+\/drafts\/\d+\/mail/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: patch((await res.json()) as Record<string, unknown>) });
  });
}

// ---- Overview fixtures: the server's own answer, patched, so every status level can be shown.

export type MailReadJson = { at: string | null; reason: string | null; reading: boolean; unknown: number };
export type StatusJson = { level: string; kind: string; sentence: string; next: string | null; numbers: { owed: number; wrote: number; lastTriageAt: string | null; mailRead: MailReadJson } };
type OverviewJson = { projects: ({ slug: string; status: StatusJson } & Record<string, unknown>)[] } & Record<string, unknown>;

export const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

/** Answers `GET /api/overview` with the real answer, one project's status replaced. */
export async function statusIs(page: Page, slug: string, status: Partial<StatusJson>) {
  await page.route(/\/api\/overview$/, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as OverviewJson;
    await route.fulfill({ response: res, json: { ...json, projects: json.projects.map((p) => (p.slug === slug ? { ...p, status: { ...p.status, ...status } } : p)) } });
  });
}
