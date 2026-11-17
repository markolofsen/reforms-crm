import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mailError, mailFresh, mailOff, mailStale, notionFresh, notionToken, overviewIs, remember, withLive } from "./support";

// Executable form of `app/@rules` ui-specifications 4 and accessibility 4, 6, 9: every screen, in both themes, at
// 360, 768 and 1280 px (the Playwright projects), has no axe violation, no sideways scroll, and 44px touch targets
// below 1024px. Named a-* so it runs first; nothing here writes (the Send states answer from mocked routes: the first
// draft is shown as ready and Checked, and no request reaches the real send).
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

type Screen = { name: string; path: string; ready: (page: Page) => Promise<void>; mock?: (page: Page) => Promise<void> };

/** The first draft of the real list, patched: ready, Checked, no send yet. The rest of the answer is the server's own. */
async function firstDraftIs(page: Page, patch: Record<string, unknown>) {
  await page.route(/\/api\/drafts\?/, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { drafts: Array<Record<string, unknown>> };
    const [first, ...rest] = json.drafts;
    await route.fulfill({ response: res, json: { ...json, drafts: [{ ...first, status: "ready", checked: true, batchId: null, sendState: null, injectionSuspected: false, ...patch }, ...rest] } });
  });
}
/** Opens the first row (a phone shows nothing until one is chosen; desktop already has it open) and waits for its card. */
const openFirst = async (p: Page) => {
  await p.locator('ul[aria-label="Drafts"] > li').first().getByRole("button").first().click();
  await expect(p.getByRole("article")).toBeVisible();
};
const sendButton = (p: Page) => p.getByRole("button", { name: "Send", exact: true });
const PREVIEW = { ok: true, dryRun: true, from: "Mark <mark@example.test>", to: ["client@example.com"], cc: ["mark@example.org"], subject: "Re: Second viewing", body: "Hi,\n\nThank you for your message.\n\nBest regards,\nMark" };
const SEND_ROWS = [
  { id: 3, draftId: 9, mode: "auto", status: "queued", actor: "auto", createdAt: "2026-11-15T10:00:00.000Z", dueAt: "2026-11-15T10:10:00.000Z", doneAt: null, toAddr: "ana@example.com", ccAddr: null, subject: "Re: Order status", body: "Hello Ana", error: null },
  { id: 2, draftId: 8, mode: "manual", status: "sent", actor: "admin", createdAt: "2026-11-14T09:00:00.000Z", dueAt: null, doneAt: "2026-11-14T09:00:02.000Z", toAddr: "bo@example.com", ccAddr: "mark@example.org", subject: "Re: Refund question", body: "Hello Bo", error: null },
  { id: 1, draftId: 7, mode: "manual", status: "failed", actor: "admin", createdAt: "2026-11-13T09:00:00.000Z", dueAt: null, doneAt: "2026-11-13T09:00:01.000Z", toAddr: "cy@example.com", ccAddr: null, subject: "Re: Keys", body: "Hello Cy", error: "Mail is not running" },
];
const SCREENS: Screen[] = [
  { name: "drafts", path: "/drafts", ready: async (p) => void (await p.locator('ul[aria-label="Drafts"] > li').first().waitFor()) },
  {
    name: "drafts: one draft open",
    path: "/drafts",
    ready: async (p) => {
      await openFirst(p);
      await p.getByRole("group", { name: "Actions" }).waitFor();
    },
  },
  { name: "overview", path: "/overview", ready: async (p) => void (await p.getByRole("region", { name: "Verdict" }).waitFor()) },
  {
    name: "overview: fresh and capped",
    path: "/overview",
    mock: (p) => overviewIs(p, withLive(mailFresh(3), notionFresh(2000, true))),
    ready: async (p) => void (await p.getByText("3 new since triage").first().waitFor()),
  },
  {
    name: "overview: stale",
    path: "/overview",
    mock: (p) => overviewIs(p, withLive(mailStale(4), notionFresh(212))),
    ready: async (p) => void (await p.getByText("Stale").first().waitFor()),
  },
  {
    name: "overview: mail error and notion token",
    path: "/overview",
    mock: (p) => overviewIs(p, withLive(mailError, notionToken)),
    ready: async (p) => void (await p.getByText(/The Notion token is missing\./).first().waitFor()),
  },
  {
    name: "overview: mail off",
    path: "/overview",
    mock: (p) => overviewIs(p, withLive(mailOff, notionFresh(1))),
    ready: async (p) => void (await p.getByText("No login for this account").first().waitFor()),
  },
  {
    name: "overview: error",
    path: "/overview",
    mock: async (p) => void (await p.route(/\/api\/overview$/, (route) => route.fulfill({ status: 500, json: { error: "The server could not read the projects.", code: "server" } }))),
    ready: async (p) => void (await p.getByText("Could not load the overview").waitFor()),
  },
  {
    name: "overview: focus",
    path: "/overview?focus=demo-shop",
    ready: async (p) => void (await p.locator('#project-demo-shop[data-focused="true"]').waitFor()),
  },
  { name: "activity", path: "/log", ready: async (p) => void (await p.locator("#run-1").getByRole("button", { name: "Details" }).waitFor()) },
  {
    name: "activity: run open",
    path: "/log",
    ready: async (p) => {
      await p.locator("#run-1").getByRole("button", { name: "Details" }).click();
      await p.getByText("Three new inbound messages since the last run").waitFor();
    },
  },
  { name: "bulk", path: "/bulk", ready: async (p) => void (await p.getByRole("link", { name: /new batch/i }).first().waitFor()) },
  { name: "bulk: new batch", path: "/bulk?new=1", ready: async (p) => void (await p.getByRole("heading", { name: "New batch" }).waitFor()) },
  { name: "project", path: "/project", ready: async (p) => void (await p.getByRole("switch").first().waitFor()) },
  {
    name: "project: health and an empty send history",
    path: "/project",
    mock: async (p) => void (await p.route(/\/api\/projects\/[^/]+\/sends$/, (route) => route.fulfill({ json: { sends: [], stopped: [] } }))),
    ready: async (p) => {
      await p.getByRole("list", { name: "Health checks" }).waitFor();
      await p.getByText("Nothing sent yet").waitFor();
    },
  },
  {
    name: "project: send history, a queued send, Stop all on",
    path: "/project",
    mock: async (p) => void (await p.route(/\/api\/projects\/[^/]+\/sends$/, (route) => route.fulfill({ json: { sends: SEND_ROWS, stopped: ["lisbon-realty"] } }))),
    ready: async (p) => {
      await p.getByRole("list", { name: "Sends" }).waitFor();
      await p.getByRole("button", { name: /Show text, send 3/ }).click();
      await p.getByText("Hello Ana").waitFor();
    },
  },
  {
    name: "connections: the list",
    path: "/connections",
    ready: async (p) => void (await p.getByRole("heading", { name: "Mail", exact: true }).waitFor()),
  },
  {
    name: "connections: a key form and a remove question open",
    path: "/connections",
    ready: async (p) => {
      await p.getByRole("button", { name: /^(Set|Replace) key for Notion integration$/ }).click();
      await p.getByLabel("Integration token").waitFor();
    },
  },
  {
    name: "drafts: Send confirm open",
    path: "/drafts",
    mock: async (p) => {
      await firstDraftIs(p, {});
      await p.route(/\/drafts\/\d+\/send$/, (route) => route.fulfill({ json: PREVIEW }));
    },
    ready: async (p) => {
      await openFirst(p);
      await sendButton(p).click();
      await p.getByText(/A sent mail cannot be recalled/).waitFor();
    },
  },
  {
    name: "drafts: Send refused with reasons",
    path: "/drafts",
    mock: async (p) => {
      await firstDraftIs(p, {});
      await p.route(/\/drafts\/\d+\/send$/, (route) => route.fulfill({ status: 409, json: { error: "Not sent: 2 reasons", code: "wrong_state", refused: ["Stop all is on", "a placeholder is left in the text: [Owner: price]"] } }));
    },
    ready: async (p) => {
      await openFirst(p);
      await sendButton(p).click();
      await p.getByText("Not sent: 2 reasons").waitFor();
    },
  },
  {
    name: "drafts: injection suspected and a class",
    path: "/drafts",
    mock: async (p) => void (await firstDraftIs(p, { injectionSuspected: true, mailClass: "client" })),
    ready: async (p) => {
      await openFirst(p);
      await p.getByText("Suspicious mail", { exact: false }).first().waitFor();
    },
  },
];

const INTERACTIVE = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="combobox"], [role="menuitem"]';

async function undersized(page: Page) {
  return page.evaluate((selector) => {
    const bad: string[] = [];
    let checked = 0;
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      // A control wrapped by (or labelled by) a larger label is hit through that label.
      const label = el.closest("label, [data-hit]");
      const box = (label ?? el).getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const clipped = box.width <= 1 || box.height <= 1; // the sr-only skip link
      if (clipped) continue;
      // Inline links inside running text are exempt (WCAG 2.5.8 inline exception).
      if (el.tagName === "A" && el.closest("p, li > span, td")?.textContent !== el.textContent && getComputedStyle(el).display === "inline") continue;
      checked++;
      if (box.height < 43.5) bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}" is ${Math.round(box.height)}px high`);
    }
    if (checked < 3) bad.push(`only ${checked} targets measured: the check is blind`);
    return bad;
  }, INTERACTIVE);
}

for (const scheme of ["light", "dark"] as const) {
  for (const screen of SCREENS) {
    test(`${screen.name} (${scheme}): no axe violation, no sideways scroll, 44px targets`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && !(screen.name.includes("refused") && m.text().includes("409")) && !(screen.name.endsWith(": error") && m.text().includes("500")) && errors.push(m.text()));
      await page.emulateMedia({ colorScheme: scheme });
      await screen.mock?.(page);
      await page.goto(screen.path);
      await screen.ready(page);
      await page.waitForLoadState("networkidle");

      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.any[0]?.message ?? n.failureSummary})`).join(" | ")}`)).toEqual([]);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "sideways page scroll").toBeLessThanOrEqual(0);

      if ((page.viewportSize()?.width ?? 0) < 1024) expect(await undersized(page)).toEqual([]);

      await page.screenshot({ path: info.outputPath(`${screen.name.replace(/\W+/g, "-")}-${scheme}.png`), fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}
