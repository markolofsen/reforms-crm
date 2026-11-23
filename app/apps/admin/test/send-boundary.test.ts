import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Decision 0015: mutations go through the Hono API with the typed client. "use server" and `@hub/db` are eslint errors
// (`no-restricted-syntax`, `no-restricted-imports`); this test holds that the only callers of the send client are Mail's drafts
// module and the project module, and of the messenger send door the Messengers module (P71 M4; P127 C2 moved them into lib/data).
const SRC = join(import.meta.dirname, "../src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}
const all = files(SRC).map((f) => ({ path: relative(SRC, f), text: readFileSync(f, "utf8") }));

describe("send boundary", () => {
  it("calls the one send route and its preview only from Mail's drafts module (the card's send flow)", () => {
    const users = all.filter((f) => f.path !== "lib/api/send.ts" && /\bsendApi\.(send|preview)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["lib/data/drafts.ts"]);
  });

  it("calls the messenger send door (P71 M4) only from the Messengers module", () => {
    const users = all.filter((f) => f.path !== "lib/api/messengers/send.ts" && /\bmessengerSendApi\.(send|preview)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["lib/data/messengers.ts"]);
    // Both doors' steps are the one shared hook: neither feature runs its own dry-run and apply mutations.
    const doors = all.filter((f) => /\buseSendDoor(<\w+>)?\(/.test(f.text) && f.path !== "lib/data/send-door.ts").map((f) => f.path).sort();
    expect(doors).toEqual(["lib/data/drafts.ts", "lib/data/messengers.ts"]);
  });

  it("starts Send all Checked of a batch (P85b) only from Mail's drafts module (the batch's own panel), after its dry run", () => {
    const users = all.filter((f) => f.path !== "lib/api/send.ts" && /\bbatchSendApi\.(plan|start|stop)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["lib/data/drafts.ts"]);
    // The apply carries exactly the dry run's drafts and hashes: the panel never builds its own list.
    const panel = all.find((f) => f.path === "lib/data/drafts.ts")?.text ?? "";
    expect(panel).toMatch(/batchSendApi\.start\(project, batchId, p\)/);
  });

  it("writes a draft's Mail text (Save, Restore: P56) only from the one write hook of Mail's drafts module", () => {
    const users = all.filter((f) => f.path !== "lib/api/send.ts" && /\bsendApi\.(save|restore)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["lib/data/drafts.ts"]);
  });

  it("reaches the sends, Cancel, Stop all, Resume and the doctor through lib/data/project.ts (P127 B2), and Cancel also from the card's drafts module", () => {
    const users = all.filter((f) => f.path !== "lib/api/send.ts" && /\bsendApi\.(list|cancel|stop|resume|doctor)\b/.test(f.text)).map((f) => f.path).sort();
    expect(users).toEqual(["lib/data/drafts.ts", "lib/data/project.ts"]);
    const stops = all.filter((f) => f.path !== "lib/api/send.ts" && /\bsendApi\.(stop|resume)\b/.test(f.text)).map((f) => f.path);
    expect(stops).toEqual(["lib/data/project.ts"]);
  });
});
