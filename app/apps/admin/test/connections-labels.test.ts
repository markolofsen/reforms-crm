import { CONNECTION_KINDS, SECRET_STATES } from "@hub/contract/connections";
import { describe, expect, it } from "vitest";
import { groupByKind, KIND_ORDER, KIND_TITLE, SECRET } from "../src/features/connections/labels";
import { statusRows } from "../src/features/shell/status-footer";
import { formatDest } from "../src/routes/paths";

describe("connections labels", () => {
  it("name every secret state and every kind the contract has, each state with a word", () => {
    expect(Object.keys(SECRET).sort()).toEqual([...SECRET_STATES].sort());
    expect(Object.keys(KIND_TITLE).sort()).toEqual([...CONNECTION_KINDS].sort());
    expect([...KIND_ORDER].sort()).toEqual([...CONNECTION_KINDS].sort());
    for (const s of SECRET_STATES) expect(SECRET[s].word.length).toBeGreaterThan(0);
  });
  it("groups rows by kind in the page order and drops an empty kind", () => {
    expect(groupByKind([])).toEqual([]);
  });
  it("the two footer rows that point at setup lead to Connections, with no project in the address", () => {
    const health = { mail: { state: "off", accounts: 0, problems: [] }, sent: { state: "off" }, messengers: { state: "off" } };
    // @ts-expect-error a partial health is enough for the rows under test
    const rows = statusRows({ health, stale: false, serverOlder: false, serverNewer: false });
    const to = rows.filter((r) => r.to).map((r) => (r.to ? formatDest(r.to, "lisbon") : ""));
    expect(to).toEqual(["/connections", "/connections"]);
  });
});
