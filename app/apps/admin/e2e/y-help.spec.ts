import { expect, test } from "@playwright/test";
import { SAY } from "@hub/contract/help";
import { TIPS } from "@hub/contract/tips";
import { remember } from "./support";

// Help (P63 O2, O3): the phrases to say (the skills README's own), every tip from the one list, where the files live, and the
// Hub's wiring drawn by Mermaid from `GET /api/scheme`, loaded only here (decision 0035). Read only. Two seeded projects: two subgraphs.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("help: the phrases with the project's name, every tip grouped, and no copy of the shortcut list", async ({ page }) => {
  await page.goto("/help");
  const say = page.getByTestId("help-say").getByRole("table");
  await expect(say.locator("tbody tr")).toHaveCount(SAY.length);
  await expect(say).toContainText("разбери почту проекта lisbon-realty");
  await expect(say).toContainText("привяжи эту папку Drive к клиенту <X>");
  await expect(page.getByTestId("help-tips").locator("[data-tip]")).toHaveCount(TIPS.length);
  await expect(page.getByTestId("help").locator("kbd")).toHaveCount(1);
});

test("help: the scheme is one parsed SVG (an image named by its heading) with a subgraph per project and a status word in every part", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => void (m.type() === "error" && errors.push(m.text())));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/help");
  const svg = page.getByRole("img", { name: "How it works" });
  await expect(svg).toBeVisible({ timeout: 15_000 });
  const facts = await svg.evaluate((el) => ({
    clusters: el.querySelectorAll(".cluster").length,
    nodes: el.querySelectorAll(".node").length,
    words: [...el.querySelectorAll(".node:not(.outside) text")].map((t) => t.textContent ?? ""),
    unsafe: el.querySelectorAll("script, style, foreignObject, a").length,
    handlers: [...el.querySelectorAll("*")].some((n) => [...n.attributes].some((a) => /^on/i.test(a.name))),
  }));
  expect(facts.clusters).toBe(2);
  expect(facts.nodes).toBeGreaterThan(10);
  for (const w of facts.words) expect(w).toMatch(/(Works|Needs a look|Broken|Not checked here)$/);
  expect(facts.unsafe).toBe(0);
  expect(facts.handlers).toBe(false);
  expect(errors).toEqual([]);
});

test("help: the scheme's colours are the theme's tokens, live on a theme switch with no new render", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/help");
  const svg = page.getByRole("img", { name: "How it works" });
  await expect(svg).toBeVisible({ timeout: 15_000 });
  const look = () => svg.evaluate((el) => {
    const fill = (sel: string) => {
      const shape = el.querySelector(`${sel} > rect, ${sel} > path`);
      return shape ? getComputedStyle(shape).fill : null;
    };
    return { ok: fill(".node.ok"), outside: fill(".node.outside"), text: getComputedStyle(el.querySelector("text") as Element).fill, id: el.id };
  });
  const light = await look();
  expect(light.ok).not.toBeNull();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => (await look()).ok).not.toBe(light.ok);
  const dark = await look();
  expect(dark.text).not.toBe(light.text);
  expect(dark.id).toBe(light.id); // the same element: restyled, not drawn again
});

test("help: Mermaid is fetched on Help only, never on another screen", async ({ page }) => {
  const scripts: string[] = [];
  page.on("response", (r) => void (r.request().resourceType() === "script" && scripts.push(r.url())));
  const holdsMermaid = async (urls: string[]) => (await Promise.all(urls.map(async (u) => (await page.request.get(u)).text()))).some((b) => b.includes("flowchart-elk"));
  await page.goto("/overview");
  await expect(page.getByRole("button", { name: /^All parts/ })).toBeVisible();
  const overview = [...scripts];
  expect(overview.length).toBeGreaterThan(0);
  expect(await holdsMermaid(overview)).toBe(false);
  await page.goto("/help");
  await expect(page.getByRole("img", { name: "How it works" })).toBeVisible({ timeout: 15_000 });
  expect(await holdsMermaid(scripts.filter((u) => !overview.includes(u)))).toBe(true);
});
