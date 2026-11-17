import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { firstDraftIs, mailError, mailIs, mailFresh, mailOff, mailStale, notionFresh, notionToken, overviewIs, remember, withLive } from "./support";

// Executable form of `app/@rules` ui-specifications 4 and accessibility 4, 6, 9: every screen, in both themes, at
// 360, 768 and 1280 px (the Playwright projects), has no axe violation, no sideways scroll, and 44px touch targets
// below 1024px. Named a-* so it runs first; nothing here writes (the Send states answer from mocked routes: the first
// draft is shown as ready and Checked, and no request reaches the real send).
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

type Screen = { name: string; path: string; ready: (page: Page) => Promise<void>; mock?: (page: Page) => Promise<void> };

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
// P44 rubric 2 (show less), mechanical part: how many things a person can Tab to in the first viewport, and how far down the first draft sits on a phone.
// Measured 2026-11-18 on the shipped screens: at most 30 tab stops (Drafts with a card open at 1280), 22 on the Overview. The cap leaves room for a state
// that adds a notice; a screen that goes past it needs something folded away, not a higher number. Selecting drafts makes every row's checkbox a Tab stop on
// purpose (39 at 1280), so that one state has its own cap. Not gated: colours and type sizes (no stable count), copy.
const CONTROL_CAP = 36;
const SELECTING_CAP = 44;
const FIRST_ROW_MAX_PHONE = 300;
const tabStopsInView = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,[role=switch],[role=checkbox],[role=menuitem],[role=combobox]')].filter((e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled && e.getAttribute("aria-hidden") !== "true";
      }).length,
  );
const firstRowTop = (page: Page) => page.evaluate(() => document.querySelector('ul[aria-label="Drafts"] > li')?.getBoundingClientRect().top ?? null);

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
  { name: "drafts: new batch", path: "/drafts?new=1", ready: async (p) => void (await p.getByRole("heading", { name: "New batch" }).waitFor()) },
  { name: "project", path: "/project", ready: async (p) => void (await p.getByRole("switch").first().waitFor()) },
  {
    name: "project: health and an empty send history",
    path: "/project",
    mock: async (p) => void (await p.route(/\/api\/projects\/[^/]+\/sends$/, (route) => route.fulfill({ json: { sends: [], stopped: [] } }))),
    ready: async (p) => {
      await p.getByRole("status").filter({ hasText: /\d+ pass, \d+ fail, \d+ skipped/ }).waitFor();
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
  {
    name: "drafts: Mail unreadable",
    path: "/drafts",
    mock: async (p) => {
      await firstDraftIs(p, {});
      await mailIs(p, (m) => ({ ...m, found: false, hash: null, body: "", reason: "no draft in Mail with that subject", safetyResults: [] }));
    },
    ready: async (p) => {
      await openFirst(p);
      await p.getByRole("button", { name: "Read again" }).waitFor();
    },
  },
  {
    name: "drafts: two selected",
    path: "/drafts",
    ready: async (p) => {
      await p.getByRole("button", { name: "Select drafts" }).click();
      const boxes = p.locator('ul[aria-label="Drafts"] [role="checkbox"]');
      await boxes.nth(0).click();
      await boxes.nth(1).click();
      await p.getByRole("toolbar", { name: "Selected drafts" }).waitFor();
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
      // Named steps: a timeout says which phase stalled (the page, the data, the network, axe), not just "30 s". Measured cold at
      // 360 px (2026-11-18): first row 0.25 s, idle 0.7 s, axe 0.4 s; with the CPU throttled 8x the whole screen takes 5 s.
      await screen.mock?.(page);
      await test.step("load the page", () => page.goto(screen.path));
      await test.step("the screen is ready", () => screen.ready(page));
      await test.step("the network is idle", () => page.waitForLoadState("networkidle"));

      const axe = await test.step("axe", () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze());
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.any[0]?.message ?? n.failureSummary})`).join(" | ")}`)).toEqual([]);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "sideways page scroll").toBeLessThanOrEqual(0);

      // Nothing is cut off: the Drafts filter strip shows every chip without scrolling, and every tab of the phone bar shows its whole label.
      // (The Bulk audience and intent strips hold more chips than a phone fits and scroll inside their own strip by design.)
      const strips = screen.name.startsWith("drafts") && !screen.name.includes("new batch") ? ".scroll-strip, " : "";
      expect(
        await page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(`${sel}nav[aria-label="Sections"] a`)].filter((e) => e.offsetParent !== null).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => `${e.className.split(" ")[0]} "${(e.textContent ?? "").trim().slice(0, 30)}" is ${e.scrollWidth}px wide in ${e.clientWidth}px`), strips),
        "clipped chips or labels",
      ).toEqual([]);

      if ((page.viewportSize()?.width ?? 0) < 1024) expect(await undersized(page)).toEqual([]);

      const cap = screen.name.includes("selected") ? SELECTING_CAP : CONTROL_CAP;
      expect(await tabStopsInView(page), `tab stops in the first viewport (cap ${cap})`).toBeLessThanOrEqual(cap);
      if (screen.name === "drafts" && (page.viewportSize()?.width ?? 0) < 640) expect(await firstRowTop(page), "the first draft sits this far down on a phone").toBeLessThanOrEqual(FIRST_ROW_MAX_PHONE);

      // HUB_E2E_SHOTS names a folder to keep the screenshots in (evidence for a track); otherwise they stay in the run's own output.
      const file = `${screen.name.replace(/\W+/g, "-")}-${scheme}.png`;
      await page.screenshot({ path: process.env.HUB_E2E_SHOTS ? `${process.env.HUB_E2E_SHOTS}/w${page.viewportSize()?.width}-${file}` : info.outputPath(file), fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}
