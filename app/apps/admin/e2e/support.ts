import { expect, type Locator, type Page } from "@playwright/test";

/** The address of the page as the person reads it: `/drafts/42?project=lisbon-realty`. */
export const address = (page: Page) => page.evaluate(() => location.pathname + location.search);

/** The remembered project is the cookie `hub_project` (`proxy.ts` reads it, the shell writes it); a spec sets it before the first load. */
export const remember = (page: Page, slug: string) => page.context().addCookies([{ name: "hub_project", value: slug, domain: "127.0.0.1", path: "/" }]);

/** The draft list rows, in order (a row is a button for the draft and a checkbox for the bulk mode). */
export const cards = (page: Page) => page.locator('ul[aria-label="Drafts"] > li');
/** The card of one client, once its row is open. */
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
 * The first draft of the real list, patched: ready, Checked, no send yet, unless the patch says otherwise. The rest of the
 * answer is the server's own. A function patch gets the draft and returns the fields to change (for a nested field such as the client).
 */
export async function firstDraftIs(page: Page, patch: Record<string, unknown> | ((d: Record<string, unknown>) => Record<string, unknown>)) {
  await page.route(/\/api\/drafts\?/, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { drafts: Array<Record<string, unknown>> };
    const [first, ...rest] = json.drafts;
    const base = { ...first, status: "ready", checked: true, batchId: null, sendState: null, injectionSuspected: false };
    await route.fulfill({ response: res, json: { ...json, drafts: [{ ...base, ...(typeof patch === "function" ? patch(base) : patch) }, ...rest] } });
  });
}

/** Patches the Mail read of every open draft (the rest of the answer is the fake Mailer's own). */
export async function mailIs(page: Page, patch: (mail: Record<string, unknown>) => Record<string, unknown>) {
  await page.route(/\/api\/projects\/[^/]+\/drafts\/\d+\/mail/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: patch((await res.json()) as Record<string, unknown>) });
  });
}

// ---- Overview fixtures: the server's own answer, patched, so every state of the page can be shown without a network read.

type Block = Record<string, unknown>;
type Card = { slug: string; name: string; archived: boolean; lastTriageAt: string | null; mailboxes: { account: string; shared: boolean; newSinceTriage: Block }[]; notion: { clients: { dataSourceId: string; count: Block } | null; leads: { dataSourceId: string; count: Block } | null } } & Record<string, unknown>;
export type OverviewJson = { projects: Card[]; attention: Record<string, unknown>[]; verdict: Record<string, unknown>; oldestAsOf: string | null; system: Record<string, unknown> } & Record<string, unknown>;

export const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const reading = (count: number, mins: number) => ({ count, since: minutesAgo(60 * 24), mayOverstate: false, asOf: minutesAgo(mins) });
export const mailFresh = (count: number, mins = 2): Block => ({ state: "fresh", asOf: minutesAgo(mins), value: { count, since: reading(count, mins).since, mayOverstate: false } });
export const mailStale = (count: number): Block => ({ state: "stale", asOf: minutesAgo(180), value: { count, since: minutesAgo(60 * 24), mayOverstate: true } });
export const mailError: Block = { state: "error", code: "login-refused", message: "The mail server refused the login.", fix: "Check the password file in state/secrets.", asOf: minutesAgo(30), value: { count: 3, since: minutesAgo(60 * 24), mayOverstate: false } };
export const mailOff: Block = { state: "off", message: "No login for this account" };
export const notionFresh = (count: number, capped = false): Block => ({ state: "fresh", asOf: minutesAgo(5), value: { count, capped } });
export const notionToken: Block = { state: "error", code: "token-missing", message: "The Notion token is missing.", fix: "Put the token alone in state/secrets/notion-token, then Refresh." };

/** Answers `GET /api/overview` with the real answer run through `patch`. */
export async function overviewIs(page: Page, patch: (dto: OverviewJson) => OverviewJson) {
  await page.route(/\/api\/overview$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    await route.fulfill({ response: res, json: patch((await res.json()) as OverviewJson) });
  });
}

/** Every card's live blocks set at once (the seeded projects list one mailbox and a Notion clients source). */
export const withLive = (mail: Block, notion: Block) => (dto: OverviewJson): OverviewJson => ({
  ...dto,
  projects: dto.projects.map((p) => ({
    ...p,
    mailboxes: p.mailboxes.map((m) => ({ ...m, newSinceTriage: mail })),
    notion: { clients: p.notion.clients && { ...p.notion.clients, count: notion }, leads: p.notion.leads && { ...p.notion.leads, count: notion } },
  })),
});
