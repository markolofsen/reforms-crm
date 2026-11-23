import { describe, expect, it } from "vitest";
import { composerStateOf } from "../src/composer";

describe("composer state contract", () => {
  it("keeps the normal editing lifecycle discriminated", () => {
    expect(composerStateOf({ body: "" })).toEqual({ state: "idle" });
    expect(composerStateOf({ body: "hello" })).toEqual({ body: "hello", state: "editing" });
    expect(composerStateOf({ body: "", editing: true })).toEqual({ body: "", state: "editing" });
    expect(composerStateOf({ body: "hello", saving: true })).toEqual({ body: "hello", state: "saving" });
    expect(composerStateOf({ body: "hello", draftId: 7 })).toEqual({ body: "hello", draftId: 7, state: "saved" });
    expect(composerStateOf({ body: "hello", recorded: true })).toEqual({ body: "hello", state: "recorded" });
  });

  it("prioritizes unavailable and recovery states over body flags", () => {
    expect(composerStateOf({ body: "hello", error: "failed", unavailable: "Mail is not running" })).toEqual({ reason: "Mail is not running", state: "unavailable" });
    expect(composerStateOf({ body: "hello", blocked: "Choose a brand" })).toEqual({ body: "hello", reason: "Choose a brand", state: "blocked" });
    expect(composerStateOf({ body: "hello", draftId: 7, editing: true })).toEqual({ body: "hello", state: "editing" });
  });
});
