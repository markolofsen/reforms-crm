import { describe, expect, it } from "vitest";
import { checkClientMap, diffMaps, MAP_LIMITS, mapOutline, notionMapSource, parseSourceRef, whyNeeded } from "../src/map";
import { mapCounts, nextStepOf, stuckNodes } from "../src/map-status";

// P135 verdicts 5 and 6: the server's check of a client map (a strict subset of Mermaid's flowchart plus the shape rules).
const GOOD = `flowchart TD
  c["Acme Ltd"] --> p1[Launch the shop in May]
  c --> p2[Lower card fees]
  p1 --> p1a[Pick a template]:::done
  p1 --> p1b[Import 400 products]
  p1b -->|offered| p1b1["Import service (Pro plan)"]
  p2 -.-> p2a[Waiting for their bank]
  class p1b1 open
  class p2a waiting
  subgraph mail[Mail]
    p1b
  end
  %% src p1: <CAF1@mail.example>
  %% src p2: 2026-11-18 telegram
  %% src p1a: CAF1@mail.example
  %% src p1b: CAF1@mail.example, 2026-11-20 mail
  %% src p1b1: 2026-11-20 mail
  %% src p2a: 2026-11-19 call
`;
/** A map of the shape with no source lines: what P135 stored. */
const OLD = GOOD.split("\n").filter((l) => !l.includes("%% src")).join("\n");

describe("checkClientMap", () => {
  it("accepts a map of the shape: one root, states on the leaves", () => {
    const r = checkClientMap(GOOD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.root).toBe("c");
    expect(r.nodes).toHaveLength(7);
    expect(r.depth).toBe(3);
    expect(r.sources.p1b).toEqual(["CAF1@mail.example", "2026-11-20 mail"]);
    expect(mapOutline(r).map((l) => `${l.depth}:${l.label}:${l.state ?? "-"}`)).toEqual(["0:Acme Ltd:-", "1:Launch the shop in May:-", "2:Pick a template:done", "2:Import 400 products:-", "3:Import service (Pro plan):open", "1:Lower card fees:-", "2:Waiting for their bank:waiting"]);
  });
  it.each([
    ["graph LR\n a[A] --> b[B]:::open", 1, "flowchart TD"],
    ["flowchart TD\n a[A] --> b[B]\n classDef open fill:#fff", 3, "not allowed"],
    ["flowchart TD\n a[A] --> b[B]:::open\n click b href", 3, "not allowed"],
    ["flowchart TD\n a[A] --> b[<b>B</b>]:::open", 2, "label"],
    ["flowchart TD\n a[A] --> b[B]:::urgent", 2, "state class"],
    ["flowchart TD\n a[A] --> b[B]\n b --> c[C]:::open\n x[X] --> y[Y]:::open", null, "roots"],
    ["flowchart TD\n a[A] --> b[B]", null, "has no state"],
    ["flowchart TD\n a[A] --> b", 2, "has no label"],
    ["flowchart TD\n a[A] --> b[one two three four five six seven]:::open", 2, "words"],
    ["flowchart TD\n a[A] --> b[ana@example.com]:::open", 2, "address or phone"],
    ["flowchart TD\n a[A] --> b[Call +351 912 345 678]:::open", 2, "address or phone"],
    ["flowchart TD\n a[A] --> b[2026-11-30 or 912 345 678]:::open", 2, "address or phone"],
    ["flowchart TD\n a[A] --> a", 2, "itself"],
    ["flowchart TD\n a[A] -- text --> b[B]:::open", 2, "edge"],
    ["flowchart TD\n subgraph s[S]\n subgraph t[T]\n end\n end", 3, "nest"],
    ["flowchart TD\n a[A] --> b[B]:::open\n a --> b[Other]", 3, "two labels"],
    ["flowchart TD\n end[A] --> b[B]:::open", 2, "keyword"],
  ])("refuses %j at line %s (%s)", (source, line, word) => {
    const r = checkClientMap(source, { sources: "optional" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.line).toBe(line);
    expect(r.error).toContain(word);
  });
  it("refuses a node below the client with no source (P136 verdict 1), and reads an old version when asked to", () => {
    expect(checkClientMap(OLD)).toMatchObject({ ok: false, error: expect.stringContaining("p1, p2, p1a, p1b have no source") });
    const one = GOOD.replace("  %% src p2a: 2026-11-19 call\n", "");
    expect(checkClientMap(one)).toMatchObject({ ok: false, line: 7, error: "p2a has no source: add a line %% src <id>: <message id or YYYY-MM-DD channel> for each" });
    expect(checkClientMap(OLD, { sources: "optional" })).toMatchObject({ ok: true, sources: {} });
    expect(checkClientMap(`${GOOD}  %% src zz: 2026-11-20 mail\n`)).toMatchObject({ ok: false, error: expect.stringContaining("which is no node") });
    expect(checkClientMap(GOOD.replace("2026-11-19 call", "last week"))).toMatchObject({ ok: false, error: expect.stringContaining("neither a message id") });
  });
  it("reads a source ref as a message id or a day and a channel", () => {
    expect(parseSourceRef("<abc@x.example>")).toEqual({ kind: "message", id: "abc@x.example" });
    expect(parseSourceRef("2026-11-20 Telegram")).toEqual({ kind: "day", day: "2026-11-20", channel: "telegram" });
    expect(parseSourceRef("2026-11-20")).toBeNull();
    expect(parseSourceRef("two words")).toBeNull();
  });
  it("diffs two versions by id: added, removed, renamed, state changes; removed and renamed need a reason", () => {
    const a = checkClientMap(GOOD);
    const b = checkClientMap(GOOD.replace("[Lower card fees]", "[Lower the card fees]").replace("p1b1 open", "p1b1 done").replace("  p2 -.-> p2a[Waiting for their bank]\n", "  p2 --> p2b[Bank answered]:::done\n").replace("class p2a waiting\n", "").replace("%% src p2a: 2026-11-19 call", "%% src p2b: 2026-11-21 call"));
    if (!a.ok || !b.ok) throw new Error(a.ok ? (b.ok ? "" : b.error) : a.error);
    const d = diffMaps(a, b);
    expect(d).toEqual({
      added: [{ id: "p2b", label: "Bank answered", state: "done" }],
      removed: [{ id: "p2a", label: "Waiting for their bank" }],
      renamed: [{ id: "p2", from: "Lower card fees", to: "Lower the card fees" }],
      states: [{ id: "p1b1", label: "Import service (Pro plan)", from: "open", to: "done" }],
    });
    expect(whyNeeded(d)).toEqual(["p2a", "p2"]);
    expect(diffMaps(null, a).added).toHaveLength(7);
    expect(mapCounts(a)).toEqual({ open: 1, waiting: 1, done: 1, blocked: 0 });
  });
  it("finds the blocked nodes and the ones waiting 7 days or more, since the oldest version of the run", () => {
    const now = Date.parse("2026-11-24T00:00:00.000Z");
    const blocked = GOOD.replace("class p1b1 open", "class p1b1 blocked");
    const v = [
      { source: blocked, at: "2026-11-23T00:00:00.000Z" },
      { source: GOOD, at: "2026-11-15T00:00:00.000Z" },
      { source: GOOD, at: "2026-11-10T00:00:00.000Z" },
      { source: GOOD.replace("class p2a waiting", "class p2a open"), at: "2026-11-01T00:00:00.000Z" },
    ];
    expect(stuckNodes(v, now)).toEqual([
      { id: "p1b1", label: "Import service (Pro plan)", state: "blocked", since: "2026-11-23T00:00:00.000Z" },
      { id: "p2a", label: "Waiting for their bank", state: "waiting", since: "2026-11-10T00:00:00.000Z" },
    ]);
    expect(stuckNodes(v.slice(0, 2), now).map((n) => n.id)).toEqual(["p1b1", "p2a"]);
    expect(stuckNodes([{ source: GOOD, at: "2026-11-20T00:00:00.000Z" }], now)).toEqual([]);
  });
  it("caps the depth, the nodes and the goals", () => {
    const deep = `flowchart TD\n${["c[C]", "a[A]", "b[B]", "d[D]", "e[E]", "f[F]:::open"].map((n, i, all) => (i ? `  ${all[i - 1]!} --> ${n}` : "")).join("\n")}`;
    expect(checkClientMap(deep, { sources: "optional" })).toMatchObject({ ok: false, error: expect.stringContaining("levels deep") });
    const wide = `flowchart TD\n${Array.from({ length: MAP_LIMITS.nodes }, (_, i) => `  c[C] --> n${i}[N]:::open`).join("\n")}`;
    expect(checkClientMap(wide, { sources: "optional" })).toMatchObject({ ok: false, error: expect.stringContaining("nodes") });
    const goals = `flowchart TD\n${Array.from({ length: 7 }, (_, i) => `  c[C] --> g${i}[G]:::open`).join("\n")}`;
    expect(checkClientMap(goals, { sources: "optional" })).toMatchObject({ ok: false, error: expect.stringContaining("open goals") });
    const done = `${goals}\n  class g6 done`;
    expect(checkClientMap(done, { sources: "optional" }).ok).toBe(true);
  });
  it("the next step is the open leaf with the nearest date, else the first open leaf, else the first waiting one (P136 verdict 5)", () => {
    const g = (src: string) => {
      const r = checkClientMap(src, { sources: "optional" });
      if (!r.ok) throw new Error(r.error);
      return r;
    };
    expect(nextStepOf(g(GOOD))).toBe("Import service (Pro plan)");
    const dated = "flowchart TD\n  c[C] --> p1[Goal]\n  p1 --> a[Call them]:::open\n  p1 --> b[Visit on 2026-12-03]:::open\n  p1 --> d[Sign by 2026-11-30]:::open\n";
    expect(nextStepOf(g(dated))).toBe("Sign by 2026-11-30");
    expect(nextStepOf(g("flowchart TD\n  c[C] --> p1[Goal]\n  p1 --> a[Bank answer awaited]:::waiting\n  p1 --> b[Done]:::done\n"))).toBe("Bank answer awaited");
    expect(nextStepOf(g("flowchart TD\n  c[C] --> p1[Goal]:::done\n"))).toBeNull();
  });
  it("the Notion copy drops the source lines and adds one classDef per state", () => {
    const n = notionMapSource(GOOD);
    expect(n.startsWith(OLD.trimEnd())).toBe(true);
    expect(n).not.toContain("%% src");
    expect(n.match(/^classDef (open|waiting|done|blocked) /gm)).toHaveLength(4);
  });
});
