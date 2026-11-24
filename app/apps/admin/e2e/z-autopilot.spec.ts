import { expect, test, type Page } from "@playwright/test";
import { at } from "./support";

// P139 A7 (verdict 24): the autopilot's switches on screen, against the e2e stack's own server (a throwaway HUB_HOME and HUB_DB,
// `HUB_AUTOPILOT_BRAIN=fake`, no account connected, so nothing can be sent). The owner turns on this Mac's switch with its risk
// sentence, the project's mode and one linked chat's switch; the chat's header and its row then say so in words, a write
// without the page's ticket is refused, and everything is switched off again. A turn's brain, its pacing and its send through
// the door run on fakes in `apps/server/test/messengers/autopilot/deliver.test.ts` (the e2e server reads no messenger account).

const P = "lisbon-realty";
const RITA = "Rita Falsa";
const conversation = (page: Page) => page.getByTestId("messenger-conversation");
const settings = (page: Page) => page.getByTestId("autopilot-settings");

test("autopilot: the three switches, the chat's state line and mark, and a write without a ticket refused", async ({ page }) => {
  await page.goto(at(P, "/settings/messengers"));
  const box = settings(page);
  await expect(box.getByText(/You accept that risk by switching it on/)).toBeVisible();
  const instance = box.getByRole("switch", { name: "Autopilot on this Mac" });
  await expect(instance).not.toBeChecked();
  // Off on this Mac: the chat's switch says why and cannot be turned on.
  const rules = page.getByRole("listitem", { name: `Rules for ${RITA}` });
  const chatSwitch = rules.getByRole("switch", { name: "Autopilot" });
  await expect(chatSwitch).toBeDisabled();
  await instance.click();
  await expect(instance).toBeChecked();
  await box.getByRole("button", { name: "Dry run", exact: true }).click();
  await expect(box.getByRole("button", { name: "Dry run", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(chatSwitch).toBeEnabled();
  await chatSwitch.click();
  await expect(chatSwitch).toBeChecked();
  await expect(box.getByRole("list", { name: "Chats on autopilot" })).toContainText("Autopilot · dry run");
  await expect(box.getByTestId("autopilot-today")).toContainText("0 sent");

  // The conversation's header has the same switch and the state line; the chat's row says "Autopilot".
  await page.goto(at(P, "/messengers"));
  await expect(conversation(page).getByTestId("autopilot-state")).toHaveText("Autopilot · dry run");
  await expect(conversation(page).getByRole("switch", { name: "Autopilot" })).toBeChecked();
  await expect(page.getByRole("list", { name: "Chats" }).getByRole("listitem", { name: RITA })).toContainText("Autopilot");

  // Only the admin page's own fetch with a fresh ticket writes a switch (verdict 5).
  const forged = await page.request.put(`/api/autopilot`, { data: { on: false, ticket: "x".repeat(43) } });
  expect(forged.status()).toBe(403);

  // Off again, in the header: the state line goes, and the Mac's switch goes off on Settings.
  await conversation(page).getByRole("switch", { name: "Autopilot" }).click();
  await expect(conversation(page).getByTestId("autopilot-state")).toHaveCount(0);
  await page.goto(at(P, "/settings/messengers"));
  await settings(page).getByRole("button", { name: "Off", exact: true }).click();
  await settings(page).getByRole("switch", { name: "Autopilot on this Mac" }).click();
  await expect(settings(page).getByRole("switch", { name: "Autopilot on this Mac" })).not.toBeChecked();
});
