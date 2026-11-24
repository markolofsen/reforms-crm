import { describe, expect, it } from "vitest";
import { checkClientMap, MAP_LIMITS, mapOutline, notionMapSource } from "../src/map";

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
`;

describe("checkClientMap", () => {
  it("accepts a map of the shape: one root, states on the leaves", () => {
    const r = checkClientMap(GOOD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.root).toBe("c");
    expect(r.nodes).toHaveLength(7);
    expect(r.depth).toBe(3);
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
    ["flowchart TD\n a[A] --> a", 2, "itself"],
    ["flowchart TD\n a[A] -- text --> b[B]:::open", 2, "edge"],
    ["flowchart TD\n subgraph s[S]\n subgraph t[T]\n end\n end", 3, "nest"],
    ["flowchart TD\n a[A] --> b[B]:::open\n a --> b[Other]", 3, "two labels"],
    ["flowchart TD\n end[A] --> b[B]:::open", 2, "keyword"],
  ])("refuses %j at line %s (%s)", (source, line, word) => {
    const r = checkClientMap(source);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.line).toBe(line);
    expect(r.error).toContain(word);
  });
  it("caps the depth, the nodes and the goals", () => {
    const deep = `flowchart TD\n${["c[C]", "a[A]", "b[B]", "d[D]", "e[E]", "f[F]:::open"].map((n, i, all) => (i ? `  ${all[i - 1]!} --> ${n}` : "")).join("\n")}`;
    expect(checkClientMap(deep)).toMatchObject({ ok: false, error: expect.stringContaining("levels deep") });
    const wide = `flowchart TD\n${Array.from({ length: MAP_LIMITS.nodes }, (_, i) => `  c[C] --> n${i}[N]:::open`).join("\n")}`;
    expect(checkClientMap(wide)).toMatchObject({ ok: false, error: expect.stringContaining("nodes") });
    const goals = `flowchart TD\n${Array.from({ length: 7 }, (_, i) => `  c[C] --> g${i}[G]:::open`).join("\n")}`;
    expect(checkClientMap(goals)).toMatchObject({ ok: false, error: expect.stringContaining("open goals") });
    const done = `${goals}\n  class g6 done`;
    expect(checkClientMap(done).ok).toBe(true);
  });
  it("the Notion copy adds one classDef per state", () => {
    const n = notionMapSource(GOOD);
    expect(n.startsWith(GOOD.trimEnd())).toBe(true);
    expect(n.match(/^classDef (open|waiting|done|blocked) /gm)).toHaveLength(4);
  });
});
