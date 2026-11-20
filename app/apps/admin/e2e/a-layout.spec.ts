import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { stubChats } from "./messengers-stubs";
import { at, firstDraftIs, mailIs, remember } from "./support";

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
  { id: 3, draftId: 9, channel: "mail", messengerDraftId: null, mode: "auto", status: "queued", actor: "auto", createdAt: "2026-11-15T10:00:00.000Z", dueAt: "2026-11-15T10:10:00.000Z", doneAt: null, toAddr: "ana@example.com", ccAddr: null, subject: "Re: Order status", body: "Hello Ana", error: null },
  { id: 2, draftId: 8, channel: "mail", messengerDraftId: null, mode: "manual", status: "sent", actor: "admin", createdAt: "2026-11-14T09:00:00.000Z", dueAt: null, doneAt: "2026-11-14T09:00:02.000Z", toAddr: "bo@example.com", ccAddr: "mark@example.org", subject: "Re: Refund question", body: "Hello Bo", error: null },
  { id: 1, draftId: 7, channel: "mail", messengerDraftId: null, mode: "manual", status: "failed", actor: "admin", createdAt: "2026-11-13T09:00:00.000Z", dueAt: null, doneAt: "2026-11-13T09:00:01.000Z", toAddr: "cy@example.com", ccAddr: null, subject: "Re: Keys", body: "Hello Cy", error: "Mail is not running" },
];
// P44 rubric 2 (show less), mechanical part: how many things a person can Tab to in the first viewport, and how far down the first draft sits on a phone.
// Measured 2026-11-18 on the shipped screens: at most 30 tab stops (Drafts with a card open at 1280), 22 on the Overview. The cap leaves room for a state
// that adds a notice; a screen that goes past it needs something folded away, not a higher number. Selecting drafts makes every row's checkbox a Tab stop on
// purpose (39 at 1280), so that one state has its own cap. The first draft on a phone: 381px on real data before P48 (a paragraph and an accordion above
// the list), 200 since (one header line and one status line). Not gated: colours and type sizes (no stable count), copy.
const CONTROL_CAP = 36;
const SELECTING_CAP = 44;
const FIRST_ROW_MAX_PHONE = 200;
const P = "lisbon-realty";
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
  { name: "drafts", path: at(P, "/drafts"), ready: async (p) => void (await p.locator('ul[aria-label="Drafts"] > li').first().waitFor()) },
  {
    name: "drafts: one draft open",
    path: at(P, "/drafts"),
    ready: async (p) => {
      await openFirst(p);
      await p.getByRole("group", { name: "Actions" }).waitFor();
    },
  },
  { name: "drafts: follow-ups", path: at(P, "/drafts?filter=sequences"), ready: async (p) => void (await p.getByTestId("follow-ups").waitFor()) },
  { name: "drafts: not by email", path: at(P, "/drafts?filter=not_by_email"), ready: async (p) => void (await p.getByTestId("not-by-email").waitFor()) },
  {
    name: "overview",
    path: "/overview",
    ready: async (p) => {
      await p.getByRole("table", { name: "Projects" }).or(p.getByRole("list", { name: "Projects" })).first().waitFor();
      await p.getByTestId("needs-you").or(p.getByTestId("everything-works")).first().waitFor();
    },
  },
  {
    name: "overview: error",
    path: "/overview",
    mock: async (p) => void (await p.route(/\/api\/overview$/, (route) => route.fulfill({ status: 500, json: { error: "The server could not read the projects.", code: "server" } }))),
    ready: async (p) => void (await p.getByText("Could not load the overview").waitFor()),
  },
  { name: "activity", path: at(P, "/log"), ready: async (p) => await expect(p.getByRole("list", { name: "Loading the activity" })).toHaveCount(0) },
  // P73: one client's timeline (the draft card's history) replaces the opened session.
  { name: "activity: one client", path: at(P, "/log?client=1"), ready: async (p) => await expect(p.getByRole("list", { name: "Loading the activity" })).toHaveCount(0) },
  { name: "settings: sending", path: at(P, "/settings"), ready: async (p) => void (await p.getByTestId("sending-status").waitFor()) },
  {
    name: "settings: sending, Stop all on",
    path: at(P, "/settings"),
    mock: async (p) => void (await p.route(/\/api\/projects\/[^/]+\/sends$/, (route) => route.fulfill({ json: { sends: SEND_ROWS, stopped: ["lisbon-realty"] } }))),
    ready: async (p) => void (await p.getByRole("button", { name: "Resume lisbon-realty" }).waitFor()),
  },
  // UX pass 2026-11-20: the send history is Activity ▸ Sends.
  {
    name: "activity: sends, none yet",
    path: at(P, "/log?filter=sends"),
    mock: async (p) => void (await p.route(/\/api\/projects\/[^/]+\/sends$/, (route) => route.fulfill({ json: { sends: [], stopped: [] } }))),
    ready: async (p) => void (await p.getByText("No sends yet").waitFor()),
  },
  {
    name: "activity: sends, a queued one",
    path: at(P, "/log?filter=sends"),
    mock: async (p) => void (await p.route(/\/api\/projects\/[^/]+\/sends$/, (route) => route.fulfill({ json: { sends: SEND_ROWS, stopped: [] } }))),
    ready: async (p) => void (await p.getByRole(p.viewportSize()!.width < 640 ? "list" : "table", { name: "Sends" }).getByText("Re: Order status").waitFor()),
  },
  // P70: Knowledge, the Settings panes, Help.
  { name: "knowledge", path: at(P, "/knowledge"), ready: async (p) => void (await p.getByRole("table", { name: "Knowledge entries" }).or(p.getByRole("list", { name: "Knowledge entries" })).or(p.getByText("No knowledge yet")).first().waitFor()) },
  // P75: every rule in view, nothing folded; measured under CONTROL_CAP before the pane was built (the plan's S1).
  { name: "settings: checks", path: at(P, "/settings/checks"), ready: async (p) => void (await p.getByRole("table", { name: "Checks before sending" }).locator("tr[data-rule]").first().waitFor()) },
  { name: "settings: mail", path: at(P, "/settings/mail"), ready: async (p) => void (await p.getByRole("list", { name: "Mail filters" }).waitFor()) },
  { name: "settings: agent", path: at(P, "/settings/agent"), ready: async (p) => void (await p.getByTestId("agent-tools-status").waitFor()) },
  { name: "settings: this mac", path: "/settings/mac", ready: async (p) => void (await p.getByTestId("core-block").or(p.getByText("Could not load the core update check")).first().waitFor()) },
  // P71 M3: the Messengers panel (the seeded chat of Rita with the agent's draft) and Messengers ▸ Settings.
  { name: "messengers: chats", path: at(P, "/messengers"), ready: async (p) => void (await p.getByRole("list", { name: "Chats" }).getByTestId("messenger-draft").first().waitFor()) },
  {
    name: "messengers: chats, a draft in Edit",
    path: at(P, "/messengers"),
    ready: async (p) => {
      await p.getByRole("button", { name: /^Edit the draft for / }).first().click();
      await p.getByLabel(/^Your words for this reply/).waitFor();
    },
  },
  // P84c: To do with the fresh unlinked chats and both accounts connected (the channel control), and Hidden; the memory is stubbed.
  { name: "messengers: chats, to do", path: at(P, "/messengers"), mock: async (p) => void (await stubChats(p)), ready: async (p) => void (await p.getByRole("list", { name: "New chats" }).waitFor()) },
  { name: "messengers: chats, hidden", path: at(P, "/messengers?filter=hidden"), mock: async (p) => void (await stubChats(p)), ready: async (p) => void (await p.getByRole("list", { name: "Hidden chats" }).waitFor()) },
  { name: "messengers: settings", path: at(P, "/messengers/settings"), ready: async (p) => void (await p.getByRole("list", { name: "Linked chats" }).waitFor()) },
  // P63, P81: wait for the general view's form (the drawing, or on a phone its list), so axe and the width checks never see the skeleton.
  { name: "help", path: "/help", ready: async (p) => void (await p.locator('[data-testid="scheme-general"]:is([data-form="drawn"], [data-form="list"])').waitFor({ timeout: 15_000 })) },
  {
    name: "settings: connections",
    path: "/settings/connections",
    ready: async (p) => void (await p.getByRole("button", { name: /^(Set|Replace) key for Notion integration$/ }).waitFor()),
  },
  {
    name: "settings: connections, a key form open",
    path: "/settings/connections",
    ready: async (p) => {
      await p.getByRole("button", { name: /^(Set|Replace) key for Notion integration$/ }).click();
      await p.getByLabel("Integration token").waitFor();
    },
  },
  {
    name: "drafts: Send confirm open",
    path: at(P, "/drafts"),
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
    path: at(P, "/drafts"),
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
    path: at(P, "/drafts"),
    mock: async (p) => void (await firstDraftIs(p, { injectionSuspected: true, mailClass: "client" })),
    ready: async (p) => {
      await openFirst(p);
      await p.getByRole("article").getByText("Suspicious mail", { exact: false }).first().waitFor();
    },
  },
  {
    name: "drafts: Mail unreadable",
    path: at(P, "/drafts"),
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
    // P49: the terminal open (the docked column from 1024px, the full-screen layer below), on the fake shell. The one session
    // this leaves is ended by the next run of this screen and by `z-terminal.spec.ts` before it starts.
    name: "drafts: terminal open",
    path: at(P, "/drafts"),
    ready: async (p) => {
      for (const s of ((await (await p.request.get("/api/terminal")).json()) as { sessions: { id: string }[] }).sessions) await p.request.delete(`/api/terminal/sessions/${s.id}`);
      // The page loaded before those were ended; a fresh load does not ask for a socket of a session that is gone (a console 404).
      await p.reload();
      await p.getByRole("button", { name: "Terminal", exact: true }).click();
      await expect(p.getByRole("tabpanel").locator(".xterm-rows")).toContainText("fake$", { timeout: 15_000 });
    },
  },
  {
    name: "drafts: two selected",
    path: at(P, "/drafts"),
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
      // xterm's helper textarea takes the keys of the terminal; the target the person taps is the whole terminal screen.
      if (el.classList.contains("xterm-helper-textarea")) continue;
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

      // Nothing is cut off: every tab of the phone bar shows its whole label. (The Not by email groups scroll inside their own strip by design.)
      expect(
        await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('nav[aria-label="Sections"] a')].filter((e) => e.offsetParent !== null).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => `${e.className.split(" ")[0]} "${(e.textContent ?? "").trim().slice(0, 30)}" is ${e.scrollWidth}px wide in ${e.clientWidth}px`)),
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

// P70: the phone bar is five items (Overview, Drafts, Activity, Settings, More); More holds Messengers (P71 M3), Knowledge and Help, each label whole;
// the rail (640-1279) draws parents only, so no pane is in the Sections nav there; below 640px the sub-nav is one menu.
test("phone bar and rail: parents only, the More menu whole, the sub-nav a menu on a phone", async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0;
  await page.goto(at(P, "/settings/mail"));
  const sub = page.getByRole("navigation", { name: "Settings pages" });
  await sub.waitFor();
  if (width < 640) {
    const bar = page.getByRole("navigation", { name: "Sections" }).last();
    // A dot's words ("needs you") are read before the label: the label ends the link.
    await expect(bar.getByRole("link")).toHaveText([/Overview$/, /Drafts$/, /Activity$/, /Settings$/]);
    await bar.getByTestId("tab-more").click();
    const items = page.getByRole("menuitem");
    await expect(items).toHaveText([/Messengers$/, /^Knowledge/, /^Help/]);
    const cut = await items.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    expect(cut, "cut labels in More").toEqual([]);
    await items.filter({ hasText: "Knowledge" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(at(P, "/knowledge"));
    await page.goto(at(P, "/settings/mail"));
    await sub.getByRole("button", { name: /Settings pages: Mail/ }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Sending", "Checks", "Mail", "Agent", "Connections", "This Mac"].map((n) => new RegExp(`${n}$`)));
    await page.getByRole("menuitem", { name: "This Mac" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/settings/mac");
  } else {
    await expect(sub.getByRole("link")).toHaveText(["Sending", "Checks", "Mail", "Agent", "Connections", "This Mac"].map((n) => new RegExp(`${n}$`)));
    if (width < 1280) await expect(page.getByRole("navigation", { name: "Sections" }).first().getByRole("link", { name: "Mail", exact: true })).toBeHidden();
  }
});

// P48 W4: selecting never moves the list, and a row shows its subject. Light only: the geometry is the same in dark.
test("drafts: the first row does not move when a row is selected, and the subject is not cut below 40 characters at 1280", async ({ page }) => {
  await page.goto(at(P, "/drafts?filter=all"));
  const first = page.locator('ul[aria-label="Drafts"] > li').first();
  await first.waitFor();
  const before = await first.evaluate((e) => e.getBoundingClientRect().top);
  await page.getByRole("button", { name: "Select drafts" }).click();
  await page.locator('ul[aria-label="Drafts"] [role="checkbox"]').first().click();
  await page.getByRole("toolbar", { name: "Selected drafts" }).waitFor();
  expect(await first.evaluate((e) => e.getBoundingClientRect().top)).toBe(before);
  await expect(page.getByRole("status").filter({ hasText: "1 selected" })).toBeAttached();
  if ((page.viewportSize()?.width ?? 0) >= 1280) {
    const shown = await page.locator('[data-testid="draft-subject"]').evaluateAll((els) =>
      els.map((e) => {
        const text = e.textContent ?? "";
        // How many characters fit: the share of the text's own width the box shows.
        const share = e.scrollWidth > e.clientWidth ? e.clientWidth / e.scrollWidth : 1;
        return Math.min(40, text.length) - Math.min(text.length, Math.floor(text.length * share)); // characters short of the 40 owed
      }),
    );
    expect(shown.length).toBeGreaterThan(0);
    // And it sits inside its row: a fixed button height once hid the line under the chips at 640px and up (found on real data, P48 W8).
    const outside = await page.locator('[data-testid="draft-subject"]').evaluateAll((els) =>
      els.filter((e) => { const r = e.getBoundingClientRect(); const row = e.closest("button")!.getBoundingClientRect(); return r.height === 0 || r.bottom > row.bottom + 0.5; }).map((e) => e.textContent),
    );
    expect(outside, "subjects drawn outside their row").toEqual([]);
    // Every subject shows at least 40 characters, or the whole of a shorter one.
    expect(shown.filter((n) => n > 0), "subjects cut below 40 characters (characters short)").toEqual([]);
  }
});
