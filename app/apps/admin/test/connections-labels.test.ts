import { CONNECTION_KINDS, SECRET_STATES, type ConnectionDto } from "@hub/contract/connections";
import { describe, expect, it } from "vitest";
import { foundLook, groupByKind, KIND_ORDER, KIND_TITLE, SECRET } from "../src/features/connections/labels";

const row = (kind: ConnectionDto["kind"], id: string): ConnectionDto => ({ id, kind, label: kind, secret: { state: "missing" }, identity: null, usedBy: [], can: ["set"], check: { state: "never" } });

describe("connections labels", () => {
  it("name every secret state and every kind the contract has, each state with a word", () => {
    expect(Object.keys(SECRET).sort()).toEqual([...SECRET_STATES].sort());
    expect(Object.keys(KIND_TITLE).sort()).toEqual([...CONNECTION_KINDS].sort());
    expect([...KIND_ORDER].sort()).toEqual([...CONNECTION_KINDS].sort());
    for (const s of SECRET_STATES) expect(SECRET[s].word.length).toBeGreaterThan(0);
  });

  it("groups rows by kind in the page order and drops an empty kind", () => {
    expect(groupByKind([])).toEqual([]);
    expect(groupByKind([row("telegram", "telegram:bot"), row("notion", "notion:notion-token")]).map((g) => g.kind)).toEqual(["notion", "telegram"]);
  });

  it("a mail account is found, not found, or unknown because Mail is not running: never a guess", () => {
    expect([true, false, null].map((f) => foundLook(f).word)).toEqual(["Found in Apple Mail", "Not found in Apple Mail", "Mail is not running"]);
  });
});
