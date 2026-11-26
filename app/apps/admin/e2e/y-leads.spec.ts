import { expect, test, type Page } from "@playwright/test";
import { at } from "./support";

// P138 (verdicts 1-8): Mail ▸ Leads read at a glance. The seed holds two New leads of demo-shop (a seeded instance reads no Notion),
// so the card's Notion read is patched here with a lead the way the server answers one: the form shown (never folded), the agent's
// read on top, the checks before a reply, Write on WhatsApp, the technical lines last. The writes (Not now) are patched too, so
// nothing is stored: a y-* flow. Patched routes are removed after each test.

const P = "demo-shop";
const PAGE = "5eed0000000000000000000000000001";
const API = `**/api/projects/${P}/leads/${PAGE}`;

const detail = {
  row: {
    pageId: PAGE, name: "Harbor Bikes", email: "info@almirsolutions.vom", accountEmail: null, brand: null, receivedAt: new Date(Date.now() - 3_600_000).toISOString(),
    preview: "We run three shops.", requests: 1, facts: { site: "harbor-bikes.test", country: "Portugal", segment: "Retail", volume: "3 shops" },
    open: true, notionStatus: "New", dismissedAt: null, dismissedReason: null, convertedAt: null, clientPageId: null, convertNote: null,
  },
  lead: {
    company: "Harbor Bikes", message: "We want listings from mobile.de and autoscout24.com.", form: "lead",
    sheet: {
      fields: [
        { key: "company", label: "Company", value: "Harbor Bikes", href: null },
        { key: "website", label: "Website", value: "harbor-bikes.test", href: "https://harbor-bikes.test" },
        { key: "country", label: "Country", value: "United Arab Emirates", href: null },
        { key: "segment", label: "Segment", value: "Dealer", href: null },
        { key: "volume", label: "Expected volume", value: "Under 10k/month", href: null },
        { key: "other", label: "Fleet size", value: "40", href: null },
      ],
      channel: { kind: "whatsapp", value: "+971 50 123 4567" },
      sites: [{ name: "mobile.de", href: "https://mobile.de" }, { name: "autoscout24.com", href: "https://autoscout24.com" }],
      technical: [{ label: "Locale", value: "en" }, { label: "API host", value: "api.example.test" }, { label: "Consent version", value: "3" }],
    },
    read: "Dealer in the UAE, under 10k/month: offer the Pro trial",
    pageUrl: null, phone: null, brands: [], otherContact: "WhatsApp: +971 50 123 4567",
  },
  note: null,
  notes: [
    { kind: "typo", address: "info@almirsolutions.vom", suggestion: "info@almirsolutions.com", domain: "almirsolutions.vom", meant: "almirsolutions.com" },
    { kind: "repeat", count: 2 },
  ],
  drafts: [],
};

async function patchLead(page: Page, posts: string[] = []) {
  await page.route(API, (r) => r.fulfill({ json: detail }));
  await page.route(`${API}/*`, (r) => {
    posts.push(new URL(r.request().url()).pathname.split("/").at(-1) ?? "");
    return r.fulfill({ json: { ok: true, pageId: PAGE, notion: "none", note: null } });
  });
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("P138 verdicts 1-3, 8: the form is the card: what they want in body size, the agent's read on top, technical last, nothing folded", async ({ page }) => {
  await patchLead(page);
  await page.goto(at(P, `/mail/leads/${PAGE}`));
  const card = page.getByTestId("lead-card");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Harbor Bikes");
  await expect(card.getByTestId("lead-read")).toContainText("Dealer in the UAE, under 10k/month: offer the Pro trial");
  const want = card.getByTestId("lead-want");
  await expect(want.getByRole("heading", { name: "What they want" })).toBeVisible();
  await expect(want.getByTestId("lead-field")).toHaveText([/Company\s*Harbor Bikes/, /Website\s*harbor-bikes\.test/, /Country\s*United Arab Emirates/, /Segment\s*Dealer/, /Expected volume\s*Under 10k\/month/, /Fleet size\s*40/, /Contact channel\s*WhatsApp \+971 50 123 4567/]);
  await expect(want.getByRole("link", { name: /harbor-bikes\.test/ })).toHaveAttribute("href", /^https:\/\/harbor-bikes\.test\/?$/);
  await expect(want.getByRole("list", { name: "Sites they named" }).getByRole("link")).toHaveText([/mobile\.de/, /autoscout24\.com/]);
  await expect(want.getByTestId("lead-text")).toHaveText("We want listings from mobile.de and autoscout24.com.");
  // No disclosure anywhere: the technical lines are on screen, after the form.
  await expect(card.getByRole("button", { name: "Form details" })).toHaveCount(0);
  await expect(card.getByTestId("lead-technical")).toContainText("API host");
  const order = await card.evaluate((el) => [...el.querySelectorAll("[data-testid]")].map((n) => n.getAttribute("data-testid")));
  expect(order.indexOf("lead-want")).toBeLessThan(order.indexOf("lead-technical"));
  // Verdict 8: the values are body size; the technical lines are smaller.
  const size = (testId: string) => card.getByTestId(testId).locator("dd").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size("lead-field")).toBeGreaterThan(await size("lead-technical"));
});

test("P138 verdicts 4-5: the checks before a reply sit above the actions; Write on WhatsApp opens the chat and sends nothing; Open is in ⋯", async ({ page }) => {
  await patchLead(page);
  await page.goto(at(P, `/mail/leads/${PAGE}`));
  const card = page.getByTestId("lead-card");
  const notes = card.getByRole("list", { name: "Before you reply" });
  await expect(notes.getByRole("listitem")).toHaveText(["almirsolutions.vom: did they mean .com? A reply to info@almirsolutions.vom would bounce.", "The same address sent 2 forms."]);
  const wa = card.getByRole("link", { name: /^Write on WhatsApp/ });
  await expect(wa).toHaveAttribute("href", /^(https:\/\/wa\.me\/971501234567|whatsapp:\/\/send\?phone=971501234567)$/);
  await expect(card.getByRole("button", { name: "Prepare reply" })).toBeVisible();
  await expect(card.getByRole("link", { name: /Open in (Notion|browser)/ })).toHaveCount(0);
  await card.getByRole("button", { name: "More lead actions" }).click();
  await expect(page.getByRole("menuitem", { name: /Open in (Notion|browser)/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("P138 verdict 5: N puts the open lead aside; J and K move between the leads; the keys are listed in ?", async ({ page }) => {
  const posts: string[] = [];
  await patchLead(page, posts);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(at(P, `/mail/leads/${PAGE}`));
  await expect(page.getByTestId("lead-card")).toBeVisible();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/\/mail\/leads\/5eed0000000000000000000000000002/);
  await page.keyboard.press("k");
  await expect(page).toHaveURL(new RegExp(`/mail/leads/${PAGE}`));
  await expect(page.getByTestId("lead-card")).toBeVisible();
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toContainText("next / previous lead");
  await expect(help).toContainText("prepare reply");
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("n");
  await expect.poll(() => posts).toEqual(["not-now"]);
  // The lead left the view: the list's address, and Undo on the toast.
  await expect(page).toHaveURL(/\/mail\/leads$/);
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
});

test("P138 verdicts 6-7: one views control in the list header with counts, no views column; rows by day with their facts", async ({ page }) => {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(at(P, "/mail/leads"));
    const views = page.getByRole("radiogroup", { name: "Lead views" });
    await expect(views.getByRole("radio").filter({ visible: true })).toHaveText([/^Needs you\s*2/, /^All\s*2/]);
    await expect(views.getByRole("radio", { name: /^Needs you/ })).toBeChecked();
    await expect(page.getByRole("navigation", { name: "Lead views" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Views" })).toHaveCount(0);
    await expect(page.getByTestId("lead-day").first()).toHaveText(/^(Today|Yesterday)$/);
    const harbor = page.getByTestId("lead-row").filter({ hasText: "Harbor Bikes" });
    await expect(harbor.getByTestId("lead-site")).toHaveText("harbor-bikes.test");
    await expect(harbor.getByTestId("lead-chips")).toHaveText(/Portugal\s*Retail\s*3 shops/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  // A view replaces the history entry and keeps ?view=; the address is the state.
  await page.getByRole("radiogroup", { name: "Lead views" }).getByRole("radio", { name: /^All/ }).click();
  await expect(page).toHaveURL(/\/mail\/leads\?view=all$/);
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "Lead views" }).getByRole("radio", { name: /^All/ })).toBeChecked();
});
