import { expect, test, type Page } from "@playwright/test";
import { address, clientPath, at, remember } from "./support";

// Navigation contract (rules: routes-and-url-state): the e2e instance has two projects, so a scoped address names its project
// in the path (`/lisbon-realty/mail/42`), never in a query; deep links survive a reload, Back returns from a subject to its
// list, an unknown path or a bad id is Not found (never Drafts), keys and the skip link keep the address honest, and the
// title follows the route. Named b-* so it runs before the specs that create data.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const P = "lisbon-realty";
const cards = (page: Page) => page.locator('ul[aria-label="People"] > li');
const viewMenu = (page: Page) => page.getByRole("button", { name: /^View:/ });
/** P53, P99: at 1280 Mail opens its first person and the address names them (`/mail/c/42`); a bare `/mail` only while loading or empty. */
const listed = (project: string | null, query = "") => new RegExp(`^${project ? `/${project}` : ""}/mail(/c/\\d+)?${query.replace(/[?]/g, "\\?")}$`);

async function secondPersonId(page: Page): Promise<string> {
  await page.goto(at(P, "/mail"));
  await expect(cards(page).first()).toBeVisible();
  const id = (await cards(page).nth(1).getAttribute("id"))?.replace("person-", "");
  if (!id) throw new Error("the seeded list has no second person");
  return id;
}

test("two projects: the entry is the Overview, a bare scoped address gets the remembered project in its path", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => address(page)).toBe("/overview");
  await page.goto("/mail");
  await expect.poll(() => address(page)).toMatch(listed(P));
  await page.goto("/log");
  await expect.poll(() => address(page)).toBe(at(P, "/log"));
  await page.goto("/settings/connections");
  await expect.poll(() => address(page)).toBe("/settings/connections");
  // P70: each page a cold load in its canonical form (Knowledge and the project's panes are scoped; Connections, This Mac and Help are not).
  await page.goto("/settings");
  await expect.poll(() => address(page)).toBe(at(P, "/settings"));
  await page.goto("/settings/agent");
  await expect.poll(() => address(page)).toBe(at(P, "/settings/agent"));
  // An instance pane under a project's address folds to the bare form (the sub-nav followed with the project in mind).
  await page.goto(at(P, "/settings/mac"));
  await expect.poll(() => address(page)).toBe("/settings/mac");
  await page.goto(at(P, "/settings/connections"));
  await expect.poll(() => address(page)).toBe("/settings/connections");
  await page.goto("/knowledge?filter=expired");
  await expect.poll(() => address(page)).toBe(at(P, "/knowledge?filter=expired"));
  await page.goto(at(P, "/knowledge"));
  await expect.poll(() => address(page)).toBe(at(P, "/knowledge"));
  await page.reload();
  await expect(page).toHaveTitle(`Knowledge · ${P} · Hub Workflow`);
  await page.goto("/help");
  await expect.poll(() => address(page)).toBe("/help");
  await expect(page).toHaveTitle("Help · Hub Workflow");
  // P71 M3: Messengers is scoped (the linked chats are a project's); its View and its Settings page reload in place.
  // No channel is connected in the e2e instance, so an asked channel falls back to all and leaves the address (it says what is shown).
  await page.goto("/messengers?filter=linked&channel=whatsapp");
  await expect.poll(() => address(page)).toMatch(new RegExp(`^${at(P, "/messengers/c/")}\\d+\\?filter=linked$`));
  await page.goto("/settings/messengers");
  await expect.poll(() => address(page)).toBe(at(P, "/settings/messengers"));
  await page.reload();
  await expect(page).toHaveTitle(`Messengers · ${P} · Hub Workflow`);
});

test("saved links of the query era (until 2026-11-18) open the same view in the path form", async ({ page }) => {
  const id = await secondPersonId(page);
  await page.goto(`/mail/c/id-${id}?project=${P}&filter=all`);
  await expect.poll(() => address(page)).toBe(at(P, `${await clientPath(page, P, id)}?filter=all`));
  await page.goto("/mail?project=demo-shop");
  // P99: the arrival is Needs you, the default view, so the address carries no view.
  await expect.poll(() => address(page)).toMatch(listed("demo-shop"));
  await page.goto(`/mail?project=${P}&new=1`); // the batch builder's address: gone, the list opens
  await expect.poll(() => address(page)).toMatch(listed(P));
});

test("a Mail deep link with an open conversation survives a reload", async ({ page }) => {
  const id = await secondPersonId(page);
  await page.goto(at(P, `/mail/c/id-${id}`));
  const current = page.locator(`ul[aria-label="People"] > li#person-${id}`);
  await expect(current).toHaveAttribute("data-open", "true");
  await page.reload();
  await expect(current).toHaveAttribute("data-open", "true");
  // P103: the address names him by his email (the id form replaced in place).
  await expect.poll(() => address(page)).toBe(at(P, await clientPath(page, P, id)));
  await expect(page).toHaveTitle(new RegExp(`^Conversation \\S+@\\S+ · Mail · ${P} · Hub Workflow$`));
});

test("a view in the address survives a reload, and a bad one resets", async ({ page }) => {
  await page.goto(at(P, "/mail?filter=waiting"));
  await expect(viewMenu(page)).toContainText("Waiting");
  await page.reload();
  await expect(viewMenu(page)).toContainText("Waiting");
  await page.goto(at(P, "/mail?filter=zzz"));
  await expect(viewMenu(page)).toContainText("Needs you");
  await expect.poll(() => address(page)).toMatch(listed(P));
});

test("the first person opens in the address without a history entry; moving between people and views replaces (P53)", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await expect(cards(page).first()).toBeVisible();
  const first = (await cards(page).first().getAttribute("id"))?.replace("person-", "");
  const firstPath = await clientPath(page, P, first ?? "");
  await expect.poll(() => address(page)).toBe(at(P, firstPath)); // the conversation on screen is the one the address names
  await expect(cards(page).first()).toHaveAttribute("data-open", "true");
  const entries = await page.evaluate(() => window.history.length);
  await page.keyboard.press("j");
  await expect.poll(() => address(page)).toMatch(new RegExp(`^/${P}/mail/c/(?!${firstPath.slice("/mail/c/".length)}$)[^/?]+$`));
  await viewMenu(page).click();
  await page.getByRole("menuitemradio", { name: /^Waiting/ }).click();
  await expect.poll(() => address(page)).toMatch(listed(P, "?filter=waiting"));
  expect(await page.evaluate(() => window.history.length)).toBe(entries); // neither the auto-open, a move nor a view is a page
});

test("the Activity deep link keeps its view and its one client", async ({ page }) => {
  await page.goto(at(P, "/log?kind=all&client=1&run=1"));
  await expect.poll(() => address(page)).toBe(at(P, "/log?client=1"));
  await page.reload();
  await expect(page.getByTestId("activity-client")).toBeVisible();
  await expect(page).toHaveTitle(`Activity · ${P} · Hub Workflow`);
});

test("Settings ▸ Sending survives a reload", async ({ page }) => {
  await page.goto(at(P, "/settings"));
  await page.reload();
  await expect(page.getByTestId("sending-status")).toBeVisible();
  await expect(page).toHaveTitle(`Sending · ${P} · Hub Workflow`);
});

// P70: the addresses of the Project section, Agents and Connections are gone, with no redirect (routes rule 6).
// P99: the per-draft and per-message addresses (`/mail/<draftId>`, `/mail/in/<id>`) are gone too; P103: the bare client number
// (`/mail/c/42`, now `id-42` or his email); P125 L5: `/messengers/settings` (now Settings ▸ Messengers).
for (const bad of ["/clients", "/nope", "/mail/abc", "/mail/1/2", "/mail/1", "/mail/in/1", "/mail/c/abc", "/mail/c/42", "/messengers/settings", `/${P}/overview`, `/${P}/help`, "/settings/nope", "/project", "/project/setup", `/${P}/project/knowledge`, "/agents", `/${P}/agents`, "/connections"]) {
  test(`${bad} is Not found, with a way back, never Mail`, async ({ page }) => {
    await page.goto(bad);
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(page.locator('ul[aria-label="People"]')).toHaveCount(0);
    await expect(page).toHaveTitle("Not found · Hub Workflow");
    await page.getByRole("link", { name: "Go to Mail" }).click();
    await expect.poll(() => address(page)).toMatch(listed(P));
    await expect(cards(page).first()).toBeVisible();
  });
}

test("a client key nobody in the project has says No such client, with the way back (P103 S2)", async ({ page }) => {
  for (const key of ["id-99999", "nobody%40nowhere.example"]) {
    await page.goto(at(P, `/mail/c/${key}`));
    await expect(page.getByText("No such client")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Mail" })).toBeVisible();
  }
});

test("a conversation opens by email and by id-<n>, both ending on the email (P103 S2)", async ({ page }) => {
  const id = await secondPersonId(page);
  const path = await clientPath(page, P, id);
  await page.goto(at(P, path.toUpperCase().replace("/MAIL/C/", "/mail/c/")));
  await expect.poll(() => address(page)).toBe(at(P, path));
  await expect(page.locator(`ul[aria-label="People"] > li#person-${id}`)).toHaveAttribute("data-open", "true");
});

test("g then e / a / k / s move between screens; typing in a field is left alone", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await expect(cards(page).first()).toBeVisible();
  for (const [key, path] of [["a", "/log"], ["k", "/knowledge"], ["s", "/settings"], ["e", "/mail"]] as const) {
    await page.keyboard.press("g");
    await page.keyboard.press(key);
    await expect.poll(() => address(page)).toMatch(path === "/mail" ? listed(P) : new RegExp(`^${at(P, path)}$`));
  }
  await expect(cards(page).first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search drafts" }).fill("g");
  await page.keyboard.type("b");
  // The letters went into the field (the search is in the address as `q`); no chord moved the screen.
  await expect.poll(() => address(page)).toMatch(listed(P, "?q=gb"));
});

test("the skip link moves focus and leaves the address alone", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await expect(cards(page).first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  expect(await address(page)).toMatch(listed(P));
});

test("the nav links are real anchors in the path form; two projects show the switcher and Overview", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  const nav = page.getByRole("navigation", { name: "Sections" }).first();
  await expect(nav.getByRole("link", { name: "Mail" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Activity" })).toHaveAttribute("href", at(P, "/log"));
  await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/overview");
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute("href", at(P, "/settings"));
  await expect(nav.getByRole("link", { name: "Knowledge" })).toHaveAttribute("href", at(P, "/knowledge"));
  await expect(nav.getByRole("link", { name: "Messengers" })).toHaveAttribute("href", at(P, "/messengers"));
  await expect(nav.getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help");
  await expect(page.getByRole("button", { name: P }).first()).toBeVisible();
});

// P70, P75: the nested nav. Settings' six panes are reached by the sub-nav in every pane's header line, the landing (Sending)
// first; the sidebar draws parents only (no Settings children at any width). A tab's name ends with its label (a dot's words
// come first).
test("the nested nav: the six panes in the sub-nav of every pane, none in the sidebar", async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0;
  await page.goto(at(P, "/mail"));
  await expect(cards(page).first()).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Sections" }).first();
  const panes = [["Sending", at(P, "/settings")], ["Checks", at(P, "/settings/checks")], ["Mail", at(P, "/settings/mail")], ["Agent", at(P, "/settings/agent")], ["Connections", "/settings/connections"], ["This Mac", "/settings/mac"]] as const;
  const tab = (name: string) => new RegExp(`(^|needs you ?)${name}$`);
  for (const [name, path] of panes) {
    await page.goto(path);
    // "Mail" in the sidebar is the section (P96), never the Settings pane: the pane is known by its address.
    await expect(nav.getByRole("link", { name: /^(Checks|Agent|Connections|This Mac)$/ })).toHaveCount(0);
    await expect(nav.locator('a[href$="/settings/mail"]')).toHaveCount(0);
    const sub = page.getByRole("navigation", { name: "Settings pages" });
    if (width < 640) {
      await expect(sub.getByRole("button", { name: `Settings pages: ${name}` })).toBeVisible();
      continue;
    }
    await expect(sub.getByRole("link", { name: tab(name) })).toHaveAttribute("aria-current", "page");
    await expect(sub.getByRole("link")).toHaveText(panes.map(([n]) => tab(n)));
  }
  if (width < 640) return;
  // Keyboard alone: from Sending's sub-nav to Mail.
  await page.goto(at(P, "/settings"));
  await page.getByRole("navigation", { name: "Settings pages" }).getByRole("link", { name: tab("Mail") }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => address(page)).toBe(at(P, "/settings/mail"));
});

// Status policy for a not-found page. A route Next does not match (/nope/x/y) answers a real 404. A route that matches but
// whose id is not a number (/mail/abc) is decided on the client, after the shell has streamed, so its status is already
// sent: 200 with the Not-found body, title and a way back.
test("status policy: an unmatched path is a real 404; a streamed bad id is 200 with the Not-found body", async ({ page }) => {
  expect((await page.request.get("/nope/x/y")).status()).toBe(404);
  const streamed = await page.request.get(at(P, "/mail/c/abc"));
  expect(streamed.status()).toBe(200);
  expect(await streamed.text()).not.toContain("Sofia Teste");
});

// One project (P48 point 15): the project leaves the address, the entry is Drafts, and there is no switcher. Overview is in the
// nav and is a page (P63), not the entry. The e2e instance has two, so the answer is patched; the pages still read the real project's data.
test("one project: no project in the address, no switcher, Overview in the nav but not the entry, and a path-form link folds back", async ({ page }) => {
  await page.route(/\/api\/projects$/, (route) => route.fulfill({ json: { projects: [P] } }));
  await page.goto("/");
  await expect.poll(() => address(page)).toMatch(listed(null));
  await expect(cards(page).first()).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Sections" }).first();
  await expect(nav.getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/log");
  await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/overview");
  await expect(page.getByRole("button", { name: P })).toHaveCount(0);
  await page.goto("/overview");
  await expect.poll(() => address(page)).toBe("/overview");
  // With one project the page is "Needs you" alone: no project sentence and no project table (they would repeat the status line).
  await expect(page.getByTestId("needs-you").or(page.getByTestId("everything-works")).first()).toBeVisible();
  await expect(page.getByTestId("overview-sentence")).toHaveCount(0);
  await page.goto(at(P, "/settings/mail"));
  await expect.poll(() => address(page)).toBe("/settings/mail");
  await page.goto(at(P, "/settings/connections"));
  await expect.poll(() => address(page)).toBe("/settings/connections");
  await page.goto(at(P, "/log?kind=skipped"));
  await expect.poll(() => address(page)).toBe("/log?kind=skipped");
});

// P128 X4 (decision 0045 point 21): the list header's View trigger is the list's title, naming the section and the view.
test("the list header says where he is: Mail · <view> and Messengers · <view>", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await expect(page.getByRole("button", { name: /^View: Mail · Needs you/ })).toBeVisible();
  await page.goto(at(P, "/messengers"));
  await expect(page.getByRole("button", { name: /^View: Messengers · Needs you/ })).toBeVisible();
  // "Live" is not said while it is true (only its loss is).
  await expect(page.getByTestId("live-state")).toHaveCount(0);
});
