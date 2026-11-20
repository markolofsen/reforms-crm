import { expect, test, type Page } from "@playwright/test";
import { firstDraftIs, mailIs, remember } from "./support";

// Acceptance 1 and 4 of P29, in a browser: every state of the review card (research 16 section 7) shows the number of
// `primary` buttons its row of the table says (`primaryFor`), never two, and the permanent controls stay away from Send.
// The first draft of the real list is patched per case and nothing is written (the send answers from routes).
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const PREVIEW = { ok: true, dryRun: true, from: "Mark <mark@example.test>", to: ["client@example.com"], cc: [], subject: "Re: Second viewing", body: "Hi,\n\nThank you.\n\nBest regards" };
const RED = [{ kind: "cc_present", level: "red", text: "Someone is in Cc.", acked: false }];
const soon = () => new Date(Date.now() + 10 * 60_000).toISOString();

type Case = { state: string; patch: Record<string, unknown> | ((d: Record<string, unknown>) => Record<string, unknown>); primary: 0 | 1; label?: RegExp; before?: (p: Page) => Promise<unknown>; act?: (p: Page) => Promise<void> };
const CASES: Case[] = [
  { state: "checks_open", patch: { checked: false, safetyResults: RED }, primary: 1, label: /^Send$/ },
  { state: "unread", patch: { checked: false, safetyResults: [] }, primary: 1, label: /^Send$/ },
  { state: "acknowledged", patch: { safetyResults: [] }, primary: 1, label: /^Send$/ },
  {
    state: "confirming",
    patch: { safetyResults: [] },
    primary: 1,
    label: /^Send to /,
    before: (p) => p.route(/\/drafts\/\d+\/send$/, (r) => r.fulfill({ json: PREVIEW })),
    act: (p) => p.getByRole("button", { name: "Send", exact: true }).click(),
  },
  { state: "sending", patch: { sendState: { id: 1, status: "sending", dueAt: null } }, primary: 1, label: /Sending/ },
  { state: "queued", patch: { sendState: { id: 1, status: "queued", dueAt: soon() } }, primary: 0 },
  { state: "sent", patch: { status: "sent" }, primary: 0 },
  { state: "done", patch: { status: "done" }, primary: 0 },
  { state: "skipped", patch: { status: "skipped" }, primary: 0 },
  { state: "hold", patch: { status: "hold" }, primary: 1, label: /^Resume$/ },
  { state: "suspicious", patch: { injectionSuspected: true }, primary: 1, label: /Open draft in Mail|Open the client's mail|Copy subject/ },
  { state: "unreadable", patch: {}, primary: 1, label: /Open draft in Mail|Open the client's mail|Copy subject/, before: (p) => mailIs(p, (m) => ({ ...m, found: false, hash: null, body: "", reason: "gone", safetyResults: [] })) },
  { state: "no_contact", patch: (d) => ({ client: { ...(d.client as object), marks: ["do_not_contact"] } }), primary: 1, label: /Open draft in Mail|Open the client's mail|Copy subject/ },
  { state: "follow_up", patch: { sequence: { enrollmentId: 999, sequence: "answered-enquiry-no-reply", step: 1, steps: 3, state: "active" } }, primary: 1, label: /Open draft in Mail|Open the client's mail|Copy subject/ },
  {
    state: "failed",
    patch: { safetyResults: [] },
    primary: 1,
    label: /^Send$/,
    before: (p) => p.route(/\/drafts\/\d+\/send$/, (r) => r.fulfill({ status: 409, json: { error: "Not sent: 1 reason", code: "wrong_state", refused: ["Stop all is on"] } })),
    act: async (p) => {
      await p.getByRole("button", { name: "Send", exact: true }).click();
      await p.getByText("Not sent: 1 reason").waitFor();
    },
  },
];

for (const c of CASES) {
  test(`card state ${c.state}: ${c.primary} primary button`, async ({ page }) => {
    await c.before?.(page);
    await firstDraftIs(page, c.patch);
    await page.goto("/mail?filter=all");
    await expect(page.getByRole("group", { name: "Actions" })).toBeVisible();
    await c.act?.(page);
    const primary = page.locator('[data-pane="detail"] [data-variant="primary"]');
    await expect(primary).toHaveCount(c.primary);
    if (c.label) await expect(primary).toHaveText(c.label);
    // Never two in view, anywhere on the page.
    expect(await page.locator('[data-variant="primary"]').count()).toBeLessThanOrEqual(1);
  });
}

test("no permanent control sits within 24 px of Send: the Client menu is across the card, Cancel send is not shown with Send", async ({ page }) => {
  await firstDraftIs(page, { safetyResults: [] });
  await page.goto("/mail?filter=all");
  // The address settles on the project's draft (/mail is another route tree, so the card mounts again there): measure that card.
  await expect(page).toHaveURL(/\/lisbon-realty\/mail\/\d+/);
  const sendButton = page.getByRole("button", { name: "Send", exact: true });
  const clientButton = page.getByRole("button", { name: "Client", exact: true });
  await expect(sendButton).toBeVisible();
  await expect(clientButton).toBeVisible();
  const send = await sendButton.boundingBox();
  const client = await clientButton.boundingBox();
  if (!send || !client) throw new Error("Send or Client is not on screen");
  const gap = Math.max(client.x - (send.x + send.width), send.x - (client.x + client.width), client.y - (send.y + send.height), send.y - (client.y + client.height));
  expect(gap).toBeGreaterThan(24);
  await expect(page.locator('[data-pane="detail"]').getByRole("button", { name: /Cancel send|Stop sending|Do not contact/ })).toHaveCount(0);
});
