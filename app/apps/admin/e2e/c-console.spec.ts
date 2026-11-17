import { expect, test } from "@playwright/test";
import { remember } from "./support";

// Hydration is the new bug class of the Next port (P32 risk R1): the server renders without a viewport, storage or clock,
// and a client that reads them in its first render shows a mismatch as a console error ("Hydration failed", React #418,
// #423, #425). Every route is loaded cold at each width and must print nothing at warning level or above, and nothing
// that names hydration. Nothing here writes.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const ROUTES = ["/overview", "/drafts", "/drafts?filter=all", "/drafts?new=1", "/log", "/log?run=1", "/project", "/nope", "/drafts/abc"];

for (const route of ROUTES) {
  test(`${route} loads cold with a clean console and no hydration message`, async ({ page }) => {
    const noise: string[] = [];
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning" || /hydrat|#418|#423|#425/i.test(m.text())) && noise.push(`${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => noise.push(`pageerror: ${e.message}`));
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    // the page did not fall into the error boundary
    await expect(page.getByText("Could not load this page")).toHaveCount(0);
    // The one allowed line: the browser logs the 404 status of the not-found document itself (a real status, by design).
    expect(noise.filter((n) => !(route === "/nope" && n === "error: Failed to load resource: the server responded with a status of 404 (Not Found)"))).toEqual([]);
  });
}

test("the server HTML is the loading state, never data, a viewport branch or a stored value", async ({ page }) => {
  // What the server cannot know (the width, the pinned rail, the clock, the projects) is read after mount, so the first render
  // is the same on both sides. Data arrives only through the client's own fetches.
  const html = (await (await page.request.get("/drafts?project=lisbon-realty")).text()).replaceAll("<!-- -->", "");
  expect(html).toContain("Loading projects");
  expect(html).not.toContain("Sofia Teste");
});
