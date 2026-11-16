import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Decision 0015: mutations go through the Hono API with the typed client. Nothing sends from a server action, and the only
// callers of the send client are the card's own send flow and its action bar.
const SRC = join(import.meta.dirname, "../src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}
const all = files(SRC).map((f) => ({ path: relative(SRC, f), text: readFileSync(f, "utf8") }));

describe("send boundary", () => {
  it("has no server action and no direct database import", () => {
    expect(all.filter((f) => /["']use server["']/.test(f.text)).map((f) => f.path)).toEqual([]);
    expect(all.filter((f) => /@hub\/db/.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it("calls the one send route and its preview only from the card's send flow", () => {
    const users = all.filter((f) => f.path !== "lib/api/send.ts" && /\bsendApi\.(send|preview)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["features/review/card/use-send-flow.ts"]);
  });

  it("reaches the history, Stop all, Resume and the doctor from the Project screen and the read-only Drafts health strip, and Cancel also from the card", () => {
    const users = all.filter((f) => f.path !== "lib/api/send.ts" && /\bsendApi\.(list|cancel|stop|resume|doctor)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["features/drafts/health-strip.tsx", "features/project/doctor-panel.tsx", "features/project/sends-panel.tsx", "features/review/card/draft-card.tsx"]);
    const stops = all.filter((f) => f.path !== "lib/api/send.ts" && /\bsendApi\.(stop|resume)\b/.test(f.text)).map((f) => f.path);
    expect(stops).toEqual(["features/project/sends-panel.tsx"]);
  });
});
