import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { at, remember } from "./support";

// P55: the Agent group on Settings ▸ Agent. The switch writes the project's row; `hub agent <slug> --prepare` (writes the session
// files, starts no CLI) then shows what the next Claude session would get. Named z-* because it writes; it ends on the defaults.
test.describe.configure({ mode: "serial" });

const P = "demo-shop";
const hub = fileURLToPath(new URL("../../installer/bin/hub.mjs", import.meta.url));
const HOME = process.env.HUB_E2E_HOME ?? "";
// The run's own projects folder: every `hub` command syncs the projects table from it, so a folder holding fewer projects
// would drop the others for the rest of the run. No HUB_PROJECT: the launcher refuses a project other than the shell's own.
const env = { ...process.env, HUB_HOME: HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: process.env.HUB_E2E_PROJECTS, HUB_PROJECT: "", NO_COLOR: "1" };
const prepared = () => {
  execFileSync("node", [hub, "agent", P, "--cli", "claude", "--prepare"], { env, encoding: "utf8" });
  return JSON.parse(readFileSync(join(HOME, "state", "projects", P, "settings.json"), "utf8")) as Record<string, unknown>;
};

test.beforeEach(async ({ page }) => {
  await remember(page, P);
});

test("agent: model Sonnet and advisor off by default; the switch round-trips into the next session's settings.json", async ({ page }) => {
  await page.goto(at(P, "/settings/agent"));
  const group = page.getByRole("region", { name: "Agent", exact: true });
  await expect(group.getByText("Applies to the next agent session.")).toBeVisible();
  await expect(group.getByRole("radiogroup", { name: "Model", exact: true }).getByRole("radio", { name: "Sonnet" })).toHaveAttribute("aria-checked", "true");
  const sw = group.getByRole("switch", { name: "Advisor" });
  await expect(sw).not.toBeChecked();
  await expect(group.getByRole("radiogroup", { name: "Advisor model" })).toHaveCount(0);
  await expect(group.getByTestId("agent-codex")).toHaveText("Codex: its own default model, no advisor.");
  expect(prepared()).toMatchObject({ model: "sonnet", env: { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" } });
  expect(prepared()).not.toHaveProperty("advisorModel");

  await sw.click();
  await expect(sw).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "Saved: applies to the next agent session." })).toBeVisible();
  const advisorModel = group.getByRole("radiogroup", { name: "Advisor model" });
  await expect(advisorModel.getByRole("radio", { name: "Fable" })).toHaveAttribute("aria-checked", "true");
  await advisorModel.getByRole("radio", { name: "Opus" }).click();
  await expect(advisorModel.getByRole("radio", { name: "Opus" })).toHaveAttribute("aria-checked", "true");
  const on = prepared();
  expect(on).toMatchObject({ model: "sonnet", advisorModel: "opus" });
  expect(on).not.toHaveProperty("env");

  // Back to the defaults: the advisor model is restored first, then the switch goes off, and off writes no advisorModel.
  await advisorModel.getByRole("radio", { name: "Fable" }).click();
  await expect(advisorModel.getByRole("radio", { name: "Fable" })).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).not.toBeChecked();
  await expect(group.getByRole("radiogroup", { name: "Advisor model" })).toHaveCount(0);
  const off = prepared();
  expect(off).not.toHaveProperty("advisorModel");
  expect(off).toMatchObject({ model: "sonnet", env: { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" } });
});
