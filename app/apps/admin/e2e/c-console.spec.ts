import { expect, test } from "@playwright/test";
import { at, remember, rememberShell } from "./support";

// Hydration is the new bug class of the Next port (P32 risk R1): the server renders without a viewport, storage or clock,
// and a client that reads them in its first render shows a mismatch as a console error ("Hydration failed", React #418,
// #423, #425). Every route is loaded cold at each width and must print nothing at warning level or above, and nothing
// that names hydration. Nothing here writes.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const P = "lisbon-realty";
// P123 U3b: Messengers' views are Needs you / Waiting / All, and a chat's link state is `?link=` (`?filter=unlinked` is gone).
const ROUTES = ["/overview", at(P, "/mail"), at(P, "/mail?filter=all"), at(P, "/mail?filter=sequences"), at(P, "/log"), at(P, "/log?client=1"), at(P, "/knowledge"), at(P, "/knowledge?filter=attention"), at(P, "/messengers"), at(P, "/messengers?filter=all&link=unlinked"), at(P, "/messengers?filter=all&link=hidden&channel=whatsapp"), at(P, "/settings/messengers"), at(P, "/settings"), at(P, "/settings/mail"), at(P, "/settings/agent"), "/settings/connections", "/settings/mac", "/help", "/nope", at(P, "/mail/c/abc")];

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
  const html = (await (await page.request.get(at(P, "/mail"))).text()).replaceAll("<!-- -->", "");
  expect(html).toContain("Loading projects");
  expect(html).not.toContain("Sofia Teste");
});

// The theme (P48 W1): next-themes sets the class before the first paint, so a saved choice never flashes the other theme, it
// survives a reload, and System follows the device.
const isDark = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.classList.contains("dark"));

for (const [saved, scheme, dark] of [["light", "dark", false], ["dark", "light", true], ["system", "dark", true], ["system", "light", false]] as const) {
  test(`theme: saved ${saved} on a ${scheme} device paints ${dark ? "dark" : "light"} from the first frame`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript((v) => window.localStorage.setItem("hub-theme", v), saved);
    // Read the class as the document is parsed, before any React code runs: what the first paint shows.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => ((window as unknown as { firstDark: boolean }).firstDark = document.documentElement.classList.contains("dark")), { once: true });
    });
    await page.goto(at(P, "/mail"));
    expect(await page.evaluate(() => (window as unknown as { firstDark: boolean }).firstDark)).toBe(dark);
    await page.waitForLoadState("networkidle");
    expect(await isDark(page)).toBe(dark);
  });
}

test("theme: a choice made in the sidebar survives a reload", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, "the open sidebar, with its Theme control, is a desktop surface");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(at(P, "/mail"));
  // P134 verdict 11: the theme is in the footer's "⋯" popover.
  await page.getByRole("button", { name: "Theme, sounds and shortcuts" }).click();
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Dark" }).click();
  await expect.poll(() => isDark(page)).toBe(true);
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(await isDark(page)).toBe(true);
  await page.getByRole("button", { name: "Theme, sounds and shortcuts" }).click();
  await expect(page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
});

test("the terminal saved open (P49, P128 X8) loads cold with a clean console: the server lays its column out at the saved width, unnamed, and the column follows from 1024px", async ({ page }) => {
  const noise: string[] = [];
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning" || /hydrat|#418|#423|#425/i.test(m.text())) && noise.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => noise.push(`pageerror: ${e.message}`));
  const width = page.viewportSize()?.width ?? 0;
  const wide = width >= 1024;
  // The breakpoint the last page left in the cookie: the one of this viewport, as the shell writes it.
  const bp = width >= 1600 ? "3xl" : width >= 1280 ? "xl" : wide ? "lg" : width >= 640 ? "md" : "phone";
  await rememberShell(page.context(), `dock-open.w-480.bp-${bp}`);
  await page.goto(at(P, "/mail"));
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("complementary", { name: "Terminal" })).toHaveCount(wide ? 1 : 0);
  if (wide) expect(await page.getByRole("complementary", { name: "Terminal" }).evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(480);
  expect(noise).toEqual([]);
  const html = (await (await page.request.get(at(P, "/mail"))).text()).replaceAll("<!-- -->", "");
  expect(html).not.toContain('aria-label="Terminal"');
  // No jump: the server's first paint already holds the column's box at its saved width (none below 1024px).
  expect(html.includes('data-slot="side-dock-placeholder"')).toBe(wide);
  if (wide) expect(html).toContain("--terminal-w:480px");
});
