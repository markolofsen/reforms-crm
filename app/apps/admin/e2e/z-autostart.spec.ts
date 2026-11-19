import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";

// P67: Settings ▸ This Mac ▸ Startup (P70; Connections > This Mac until then), "Start the Hub after a restart", against the real API with the FAKE launchd (HUB_LAUNCHCTL=fake in
// playwright.config.ts): each launchctl argv lands in <HOME>/state/autostart/launchctl.jsonl, the job reads as loaded and not running,
// and the LaunchAgents folder is <HOME>/state/autostart/LaunchAgents. The spec writes the plist there (the installer's job) and removes it.

const HOME = process.env.HUB_E2E_HOME ?? "";
const DIR = join(HOME, "state", "autostart");
const LABEL = `com.reforms.hub.${basename(HOME).replace(/[^A-Za-z0-9._-]/g, "-")}`;
const PLIST = join(DIR, "LaunchAgents", `${LABEL}.plist`);
const LOG = join(DIR, "launchctl.jsonl");
const argv = (): string[][] => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { argv: string[] }).argv) : []);

test.describe.configure({ mode: "serial" });
test.afterAll(() => {
  rmSync(PLIST, { force: true });
  rmSync(join(DIR, "off"), { force: true });
});

test("autostart: not set up shows the installer's line with Copy, and the switch is disabled", async ({ page }) => {
  rmSync(PLIST, { force: true });
  await page.goto("/settings/mac");
  await expect(page.getByRole("region", { name: "Start after a restart" })).toBeVisible();
  await expect(page.getByTestId("autostart-status")).toContainText("Not set up:");
  await expect(page.getByTestId("autostart-status")).toContainText("./run.sh setup --only autostart.agent");
  await expect(page.getByRole("button", { name: "Copy ./run.sh setup --only autostart.agent" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Start the Hub after a restart" })).toBeDisabled();
});

test("autostart: off and on from the keyboard run only disable and enable, and the line says the server keeps running", async ({ page }) => {
  mkdirSync(join(DIR, "LaunchAgents"), { recursive: true });
  writeFileSync(PLIST, "<plist/>");
  await page.goto("/settings/mac");
  const sw = page.getByRole("switch", { name: "Start the Hub after a restart" });
  await expect(sw).toBeChecked();
  await expect(page.getByTestId("autostart-status")).toHaveText("On: this server was started by hand; launchd takes over at the next restart.");
  const before = argv().length;
  await sw.focus();
  await page.keyboard.press("Space");
  await expect(sw).not.toBeChecked();
  await expect(page.getByTestId("autostart-status")).toHaveText("Off: this server keeps running until you stop it; it will not start after the next restart.");
  await expect(page.getByRole("status").filter({ hasText: "Off: this server keeps running" })).toBeVisible();
  expect(existsSync(join(DIR, "off"))).toBe(true);
  await page.keyboard.press("Space");
  await expect(sw).toBeChecked();
  const verbs = argv().slice(before).map((a) => a[1]).filter((v) => v !== "print" && v !== "print-disabled");
  expect(verbs).toEqual(["disable", "enable"]);
  expect(argv().some((a) => ["bootout", "kill", "kickstart"].includes(a[1] ?? ""))).toBe(false);
});
