import { describe, expect, it } from "vitest";
import { SCHEME_KINDS, type SchemeKind, type SchemeNode } from "./scheme";
import { BLOCK_IDS, BLOCK_OF, BLOCKS, blockStates, CUTS, LANE_LINKS, LANES, LINKS, stateLine, type BlockId } from "./scheme-model";

// P81, decision 0042: the model the drawing is built from. Nothing floats, every live part has a block, every cut is made of blocks.
const at = (id: string, kind: SchemeKind, project: string | null, label: string, state: SchemeNode["state"]): SchemeNode => ({ id, kind, project, label, state, detail: "", fix: null, place: null });
const laneOf = (b: BlockId) => BLOCKS.find((x) => x.id === b)?.lane;

describe("the scheme's model (P81)", () => {
  it("a kind without a block does not compile", () => {
    // @ts-expect-error: `core` is missing, so this is not a Record<SchemeKind, BlockId>.
    const missing: Record<SchemeKind, BlockId> = { cli: "agent" };
    expect(Object.keys(missing)).toHaveLength(1);
    for (const k of SCHEME_KINDS) expect(BLOCK_IDS, k).toContain(BLOCK_OF[k]);
  });

  it("five lanes, twenty blocks, each block once and in a lane, every doc page a core page", () => {
    expect(LANES.map((l) => l.label)).toEqual(["In", "Agent", "Reads", "Hub", "Out"]);
    expect(BLOCKS.map((b) => b.id).sort()).toEqual([...BLOCK_IDS].sort());
    expect(BLOCKS).toHaveLength(20);
    for (const b of BLOCKS) expect(b.doc, b.id).toMatch(/^core\/\d\d-[a-z0-9-]+\.md$/);
  });

  it("every block has a link, every link end is a block, and no link joins a block to itself", () => {
    expect(LINKS).toHaveLength(21);
    for (const b of BLOCK_IDS) expect(LINKS.some((l) => l.from === b || l.to === b), b).toBe(true);
    for (const l of LINKS) {
      expect(BLOCK_IDS).toContain(l.from);
      expect(BLOCK_IDS).toContain(l.to);
      expect(l.from).not.toBe(l.to);
      expect(l.label.split(" ").length, l.label).toBeLessThanOrEqual(4);
    }
  });

  it("every link between two lanes is one of the lane links, and every lane link carries one", () => {
    const pairs = new Set(LINKS.filter((l) => laneOf(l.from) !== laneOf(l.to)).map((l) => `${laneOf(l.from)}>${laneOf(l.to)}`));
    expect([...pairs].sort()).toEqual(LANE_LINKS.map((k) => `${k.from}>${k.to}`).sort());
  });

  it("three cuts, made of blocks: two straight chains and one fan-in into Agent", () => {
    expect(CUTS.map((c) => c.id)).toEqual(["mail-reply", "messenger-message", "session"]);
    for (const c of CUTS) for (const l of c.links) expect([BLOCK_IDS.includes(l.from), BLOCK_IDS.includes(l.to)], `${c.id}: ${l.from} -> ${l.to}`).toEqual([true, true]);
    for (const c of CUTS.slice(0, 2)) c.links.slice(1).forEach((l, i) => expect(l.from, c.id).toBe(c.links[i]?.to));
    const session = CUTS[2]?.links ?? [];
    expect(session.filter((l) => l.to === "agent").length).toBe(session.length - 1);
    expect(session.at(-1)).toMatchObject({ from: "agent", to: "log" });
  });
});

describe("a block's standing", () => {
  it("is the worst of its checked parts; a part not checked here does not count; no checked part, no standing", () => {
    const s = blockStates([at("cli:claude", "cli", null, "Claude Code", "ok"), at("a:session", "session", "a", "Agent sessions", "warn"), at("a:box", "mailbox", "a", "hi@x", "unknown"), at("a:mcp", "mail-mcp", "a", "mail-mcp", "ok"), at("a:guard", "guard", "a", "Guard", "unknown")]);
    expect(s.agent).toMatchObject({ state: "warn", bad: [{ id: "a:session" }] });
    expect(s.mail).toMatchObject({ state: "ok", bad: [] });
    expect(s.guard).toBeUndefined();
    expect(s.you).toBeUndefined();
  });

  it("the line under the drawing names the blocks and their parts, the project only with two projects, and nothing when all works", () => {
    const one = [at("a:session", "session", "a", "Agent sessions", "warn"), at("a:door", "send-door", "a", "Send door", "fail")];
    expect(stateLine(one)).toBe("Broken: Send door (Send door). Needs a look: Agent (Agent sessions).");
    const two = [...one, at("b:door", "send-door", "b", "Send door", "fail")];
    expect(stateLine(two)).toBe("Broken: Send door (Send door, a; Send door, b). Needs a look: Agent (Agent sessions, a).");
    expect(stateLine([at("a:door", "send-door", "a", "Send door", "ok"), at("core", "core", null, "Core", "unknown")])).toBeNull();
  });
});
