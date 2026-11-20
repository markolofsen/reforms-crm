import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Decision 0015: mutations go through the Hono API with the typed client. "use server" and `@hub/db` are eslint errors
// (`no-restricted-syntax`, `no-restricted-imports`); this test holds that the only callers of the send client are the card's
// own send flow and its action bar, and of the messenger send door the Messengers panel's send hook (P71 M4).
const SRC = join(import.meta.dirname, "../src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}
const all = files(SRC).map((f) => ({ path: relative(SRC, f), text: readFileSync(f, "utf8") }));

describe("send boundary", () => {
  it("calls the one send route and its preview only from the card's send flow", () => {
    const users = all.filter((f) => f.path !== "lib/api/send.ts" && /\bsendApi\.(send|preview)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["features/review/card/use-send-flow.ts"]);
  });

  it("calls the messenger send door (P71 M4) only from the Messengers panel's send hook", () => {
    const users = all.filter((f) => f.path !== "lib/api/messengers/send.ts" && /\bmessengerSendApi\.(send|preview)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["features/messengers/use-messenger-send.ts"]);
    // Both doors' steps are the one shared hook: neither feature runs its own dry-run and apply mutations.
    const doors = all.filter((f) => /\buseSendDoor(<\w+>)?\(/.test(f.text) && f.path !== "components/send/send-flow.ts").map((f) => f.path).sort();
    expect(doors).toEqual(["features/messengers/use-messenger-send.ts", "features/review/card/use-send-flow.ts"]);
  });

  it("starts Send all Checked of a batch (P85b) only from the batch's own panel, after its dry run", () => {
    const users = all.filter((f) => f.path !== "lib/api/send.ts" && /\bbatchSendApi\.(plan|start|stop)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["features/drafts/batch-send.tsx"]);
    // The apply carries exactly the dry run's drafts and hashes: the panel never builds its own list.
    const panel = all.find((f) => f.path === "features/drafts/batch-send.tsx")?.text ?? "";
    expect(panel).toMatch(/batchSendApi\.start\(project, batchId, p\)/);
  });

  it("writes a draft's Mail text (Save, Restore: P56) only from the card's one write hook", () => {
    const users = all.filter((f) => f.path !== "lib/api/send.ts" && /\bsendApi\.(save|restore)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["features/review/mail/use-mail-write.ts"]);
  });

  it("reaches Stop all, Resume and the doctor from Settings ▸ Sending (P70), the history and Cancel from Activity ▸ Sends (UX pass), and Cancel also from the card", () => {
    const users = all.filter((f) => f.path !== "lib/api/send.ts" && /\bsendApi\.(list|cancel|stop|resume|doctor)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["features/log/sends-table.tsx", "features/review/card/draft-card.tsx", "features/settings/sending/send-to.tsx", "features/settings/sending/sending-pane.tsx", "lib/status.ts"]);
    const stops = all.filter((f) => f.path !== "lib/api/send.ts" && /\bsendApi\.(stop|resume)\b/.test(f.text)).map((f) => f.path);
    expect(stops).toEqual(["features/settings/sending/sending-pane.tsx"]);
  });
});
