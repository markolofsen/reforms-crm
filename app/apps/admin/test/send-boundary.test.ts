import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Decision 0015: mutations go through the Hono API with the typed client. "use server" and `@hub/db` are eslint errors
// (`no-restricted-syntax`, `no-restricted-imports`); this test holds that the only callers of the send client are the card's
// own send flow and its action bar.
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
