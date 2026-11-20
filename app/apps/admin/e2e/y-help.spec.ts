import { expect, test, type Locator, type Page } from "@playwright/test";
import { SAY, sayFor } from "@hub/contract/help";
import { CUTS, LANE_LINKS, LINKS, BLOCKS } from "@hub/contract/scheme-model";
import { TIPS } from "@hub/contract/tips";
import { remember } from "./support";

// Help (P63 O2, O3; P81, decision 0042): the phrases in English (the skills README's own), every tip from the one list, where
// the files live, and the Hub's main blocks drawn by Mermaid from the contract's fixed model, coloured by `GET /api/scheme`, loaded
// only here (decision 0035); then three cuts. Each drawing fits its card with labels of 12 px or more, else it is a list. Read only.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const general = (page: Page) => page.getByTestId("scheme-general").getByRole("img", { name: "How it works" });
const laneOf = (id: string) => BLOCKS.find((b) => b.id === id)?.lane;
/** Links drawn in the general view: those inside a lane, and the lane links. */
const DRAWN = LINKS.filter((l) => laneOf(l.from) === laneOf(l.to)).length + LANE_LINKS.length;

/** The drawing's scale on screen and whether its box scrolls sideways. */
const fit = (svg: Locator) =>
  svg.evaluate((el) => {
    const vb = (el.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
    const box = el.parentElement as HTMLElement;
    return { scale: el.getBoundingClientRect().width / (vb[2] ?? 1), scrolls: box.scrollWidth > box.clientWidth };
  });

test("help: English phrases with the project's name, the any-language line, every tip, no copy of the shortcut list, no Cyrillic", async ({ page }) => {
  await page.goto("/help");
  const say = page.getByTestId("help-say").getByRole("table");
  await expect(say.locator("tbody tr")).toHaveCount(SAY.length);
  await expect(say.locator("tbody tr").first()).toContainText("triage mail for lisbon-realty");
  await expect(say).toContainText(sayFor("link this Drive folder to client <X>", "lisbon-realty"));
  await expect(page.getByTestId("help-say")).toContainText("in any language");
  await expect(page.getByTestId("help-tips").locator("[data-tip]")).toHaveCount(TIPS.length);
  await expect(page.getByTestId("help").locator("kbd")).toHaveCount(1);
  await expect(general(page)).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => /[Ѐ-ӿ]/.test(document.body.innerText))).toBe(false);
});

test("help: the general view is one parsed SVG: five lanes, one Agent, no status word or dashed box, dots with their word, the line under it", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => void (m.type() === "error" && errors.push(m.text())));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/help");
  const svg = general(page);
  await expect(svg).toBeVisible({ timeout: 15_000 });
  const facts = await svg.evaluate((el) => ({
    clusters: [...el.querySelectorAll(".cluster")].map((c) => c.querySelector("text")?.textContent ?? ""),
    nodes: [...el.querySelectorAll(".node")].map((n) => [...n.querySelectorAll(".label text tspan.row")].map((t) => t.textContent ?? "").join("|")),
    edges: [...el.querySelectorAll(".edgePaths path")].filter((p) => !p.classList.contains("edge-thickness-invisible")).length,
    dashed: [...el.querySelectorAll(".node > rect")].filter((r) => getComputedStyle(r).strokeDasharray !== "none").length,
    dots: [...el.querySelectorAll(".scheme-dot")].map((d) => d.querySelector("title")?.textContent ?? ""),
    unsafe: el.querySelectorAll("script, style, foreignObject, a").length,
    handlers: [...el.querySelectorAll("*")].some((n) => [...n.attributes].some((a) => /^on/i.test(a.name))),
  }));
  expect(facts.clusters.sort()).toEqual(["Agent", "Hub", "In", "Out", "Reads"]);
  expect(facts.nodes).toHaveLength(BLOCKS.length);
  expect(facts.nodes.filter((n) => n.startsWith("Agent|"))).toHaveLength(1);
  expect(facts.edges).toBe(DRAWN);
  for (const n of facts.nodes) expect(n).not.toMatch(/Works|Needs a look|Broken|Not checked here/);
  expect(facts.dashed).toBe(0);
  expect(facts.dots.length).toBeGreaterThan(0);
  for (const d of facts.dots) expect(d).toMatch(/^(Works|Needs a look|Broken)$/);
  await expect(page.getByTestId("scheme-state")).toContainText(/Every checked part works\.|Needs a look: |Broken: /);
  await expect(page.getByTestId("scheme-state").getByRole("link", { name: "Overview" })).toBeVisible();
  expect(facts.unsafe).toBe(0);
  expect(facts.handlers).toBe(false);
  expect(errors).toEqual([]);
});

test("help: three cuts under the general view, each drawn or listed, every drawing inside its card at 12 px or more", async ({ page }) => {
  await page.goto("/help");
  await expect(general(page)).toBeVisible({ timeout: 15_000 });
  for (const c of CUTS) {
    const section = page.locator(`section[data-cut="${c.id}"]`);
    await expect(section.getByRole("heading", { name: c.title })).toBeVisible();
    const wrap = page.getByTestId(`scheme-${c.id}`);
    await expect(wrap).toHaveAttribute("data-form", /^(drawn|list)$/, { timeout: 15_000 });
    if ((await wrap.getAttribute("data-form")) === "list") await expect(wrap.getByTestId("scheme-list").locator("li")).toHaveCount(c.links.length);
  }
  // A chain is drawn top to bottom on any card; its blocks are its links' ends.
  const chain = page.getByTestId("scheme-mail-reply").getByRole("img", { name: "A mail reply" });
  await expect(chain).toBeVisible();
  expect(await chain.evaluate((el) => el.querySelectorAll(".node").length)).toBe(new Set(CUTS[0]?.links.flatMap((l) => [l.from, l.to])).size);
  for (const id of ["scheme-general", ...CUTS.map((c) => `scheme-${c.id}`)]) {
    const svg = page.getByTestId(id).locator("svg");
    if ((await page.getByTestId(id).getAttribute("data-form")) !== "drawn") continue;
    const f = await fit(svg);
    expect(f.scrolls, id).toBe(false);
    expect(f.scale, id).toBeGreaterThanOrEqual(12 / 13 - 0.001);
  }
});

test("help: on a phone the general view is the lanes as a list, the chains stay drawings, and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/help");
  const wrap = page.getByTestId("scheme-general");
  await expect(wrap).toHaveAttribute("data-form", "list", { timeout: 15_000 });
  await expect(wrap.getByTestId("scheme-list")).toContainText("Agent");
  const chain = page.getByTestId("scheme-messenger-message");
  await expect(chain).toHaveAttribute("data-form", "drawn", { timeout: 15_000 });
  const f = await fit(chain.locator("svg"));
  expect(f.scrolls).toBe(false);
  expect(f.scale).toBeGreaterThanOrEqual(12 / 13 - 0.001);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("help: the scheme's colours are the theme's tokens, live on a theme switch with no new render", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/help");
  const svg = general(page);
  await expect(svg).toBeVisible({ timeout: 15_000 });
  const look = () =>
    svg.evaluate((el) => {
      const box = el.querySelector(".node > rect");
      const dot = el.querySelector(".scheme-dot");
      return { box: box ? getComputedStyle(box).fill : null, dot: dot ? getComputedStyle(dot).stroke : null, text: getComputedStyle(el.querySelector("text") as Element).fill, id: el.id };
    });
  const light = await look();
  expect(light.box).not.toBeNull();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => (await look()).box).not.toBe(light.box);
  const dark = await look();
  expect(dark.text).not.toBe(light.text);
  expect(dark.dot).not.toBe(light.dot);
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
  await expect(general(page)).toBeVisible({ timeout: 15_000 });
  expect(await holdsMermaid(scripts.filter((u) => !overview.includes(u)))).toBe(true);
});
