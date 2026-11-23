import { describe, expect, it } from "vitest";
import { FakeDraftWriter } from "@hub/mail-app/writer/fake";
import { DraftRefused, reviseMailDraft, type ReviseMailDraftInput } from "../src/drafts/write";

// P126 M3: the one revision use case for the agent's draft_write and the owner's Save and Restore. The refusals come
// before Mail is asked; the two actors differ only where the input says so.

const base = (over: Partial<ReviseMailDraftInput["draft"]> = {}, actor: "agent" | "person" = "agent"): ReviseMailDraftInput => ({
  actor,
  draft: { id: 7, project: "p", mailRef: null, status: "ready", sentAt: null, toAddr: "ana@x.example", subject: "Hello", brand: null, wroteTo: null, context: null, ...over } as ReviseMailDraftInput["draft"],
  body: "Hi Ana",
  writer: new FakeDraftWriter(),
  mail: { accounts: ["desk"], sender: null },
  brands: { brands: [] },
  live: [],
  quote: actor === "agent" ? "add" : "keep",
  signNew: (body) => ({ body, wroteTo: null, brand: null, brandReason: "test", signature: "none" }),
});

describe("reviseMailDraft", () => {
  it("refuses a sent draft for both actors, with the reader's sentence", async () => {
    for (const actor of ["agent", "person"] as const) {
      const e = await reviseMailDraft(base({ status: "sent", sentAt: "2026-11-20T10:00:00.000Z", mailRef: "a@b" }, actor)).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(DraftRefused);
      expect(e).toMatchObject({ code: "already_sent", kind: "wrong_state" });
    }
  });

  it("refuses a finished draft for the agent only", async () => {
    await expect(reviseMailDraft(base({ status: "done", mailRef: null }, "agent"))).rejects.toMatchObject({ code: "draft_finished" });
    // A person's Save of a finished draft goes on to the thread check (this one answers no message).
    await expect(reviseMailDraft(base({ status: "done", mailRef: null }, "person"))).rejects.toMatchObject({ code: "no_thread", message: "This draft answers no Mail message, so it cannot be written here." });
  });

  it("refuses a draft that answers no message and is no new thread", async () => {
    await expect(reviseMailDraft(base({ mailRef: null }))).rejects.toMatchObject({ code: "no_thread", message: expect.stringMatching(/^Draft 7 has no mailRef/) });
  });
});
