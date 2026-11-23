import type { SchemeKind, SchemeNode, SchemeState } from "./scheme";

/**
 * The Hub's main blocks and what goes through what (P81, decision 0042): a fixed model, not something the server assembles. Help
 * draws it as one general view (five lanes) and three cuts; the live parts of `GET /api/scheme` only colour it, each part folded
 * into its block by `BLOCK_OF`. A new part kind without a block is a compile error, a block without a link fails a unit test, so
 * nothing floats. `doc` names the block's page under `@docs/core/` (P80 names the same blocks in the docs' overview).
 */

export const LANES = [
  { id: "in", label: "In" },
  { id: "agent", label: "Agent" },
  { id: "reads", label: "Reads" },
  { id: "hub", label: "Hub" },
  { id: "out", label: "Out" },
] as const;
export type LaneId = (typeof LANES)[number]["id"];

export const BLOCK_IDS = ["you", "mail", "messengers", "drops", "agent", "skills", "rules", "guard", "knowledge", "notion", "google", "browser", "tools", "server", "admin", "log", "llm", "policy", "door", "client"] as const;
export type BlockId = (typeof BLOCK_IDS)[number];

export interface Block {
  id: BlockId;
  lane: LaneId;
  /** The box's first line: a fixed word, never a name from the instance. */
  label: string;
  /** The box's second line: what it is, in a few words. */
  what: string;
  /** With two or more parts of this kind the second line counts them ("2 mailboxes, read through mail-mcp"). */
  counted?: { kind: SchemeKind; what: (n: number) => string };
  /** Its page under `@docs/core/` (or another `@docs` page), relative to `@docs/`. */
  doc: string;
}

/** In lane order; inside a lane the order is the layout's knob (dagre keeps it where it can). */
export const BLOCKS: readonly Block[] = [
  { id: "you", lane: "in", label: "You", what: "the owner", doc: "core/24-terminal.md" },
  { id: "mail", lane: "in", label: "Client mail", what: "Apple Mail, read through mail-mcp", counted: { kind: "mailbox", what: (n) => `${n} mailboxes, read through mail-mcp` }, doc: "core/02-connectors.md" },
  { id: "messengers", lane: "in", label: "Messengers", what: "Telegram and WhatsApp, linked chats only", doc: "core/24-terminal.md" },
  { id: "drops", lane: "in", label: "Dropped files", what: "copied under state/drops", doc: "core/24-terminal.md" },
  { id: "rules", lane: "agent", label: "Project rules", what: "project.md, session and chat rules, mail filters", doc: "core/16-projects-and-knowledge.md" },
  { id: "skills", lane: "agent", label: "Skills and workflows", what: "skills/, the project's workflows", doc: "core/20-workflows.md" },
  { id: "agent", lane: "agent", label: "Agent", what: "Claude Code or Codex", doc: "core/24-terminal.md" },
  { id: "guard", lane: "agent", label: "Guard", what: "deny list, hooks, Notion scope", doc: "core/26-capabilities.md" },
  { id: "knowledge", lane: "reads", label: "Knowledge", what: "the project's entries, hub mcp", doc: "core/16-projects-and-knowledge.md" },
  { id: "notion", lane: "reads", label: "Notion CRM", what: "the project's own databases", doc: "core/15-notion-project-deploy-skill.md" },
  { id: "google", lane: "reads", label: "Calendar and Drive", what: "the connectors a project attaches", doc: "core/26-capabilities.md" },
  { id: "browser", lane: "reads", label: "Your browser", what: "your own extension; the Hub adds none", doc: "core/26-capabilities.md" },
  { id: "tools", lane: "hub", label: "Hub tools", what: "hub mcp: drafts, focus, messengers", doc: "core/24-terminal.md" },
  { id: "server", lane: "hub", label: "Server and app.db", what: "the local API and its database", doc: "core/08-local-app-stack.md" },
  { id: "log", lane: "hub", label: "Agent log", what: "every turn of a session", doc: "core/25-agent-log.md" },
  { id: "admin", lane: "hub", label: "Admin", what: "Mail, Messengers, Activity, Knowledge, Overview, Settings, Help", doc: "core/06-local-admin-app.md" },
  { id: "llm", lane: "hub", label: "LLM", what: "@hub/llm, cheap typed calls", doc: "core/27-llm.md" },
  { id: "policy", lane: "out", label: "Send policy and checks", what: "who may get a draft, the checks before Send", doc: "core/14-bulk-send-interface.md" },
  { id: "door", lane: "out", label: "Send door", what: "one draft, after your Send", doc: "core/14-bulk-send-interface.md" },
  { id: "client", lane: "out", label: "The client", what: "a reply by mail or chat", doc: "core/02-connectors.md" },
];

/** `flow`: what goes through; `limits`: a rule that narrows the other end (drawn dotted); `two-way`: both directions. */
export type LinkKind = "flow" | "limits" | "two-way";
export interface Link {
  from: BlockId;
  to: BlockId;
  /** Two to four words. */
  label: string;
  kind: LinkKind;
}

const flow = (from: BlockId, to: BlockId, label: string, kind: LinkKind = "flow"): Link => ({ from, to, label, kind });

/** The general view's links: block to block, never to a lane (dagre handles a subgraph end unevenly). */
export const LINKS: readonly Link[] = [
  flow("you", "agent", "a phrase"),
  flow("you", "admin", "Send, Edit, Skip"),
  flow("mail", "agent", "reads"),
  flow("messengers", "server", "stores linked chats"),
  flow("drops", "agent", "a file path"),
  flow("rules", "agent", "binds"),
  flow("skills", "agent", "the steps"),
  flow("guard", "agent", "denies", "limits"),
  flow("agent", "knowledge", "searches"),
  flow("agent", "notion", "reads, updates"),
  flow("agent", "google", "reads, links"),
  flow("agent", "browser", "if set up"),
  flow("agent", "tools", "drafts, focus, highlight"),
  flow("agent", "log", "every turn"),
  flow("tools", "server", "records"),
  flow("log", "admin", "Activity"),
  flow("server", "admin", "live panels, focus", "two-way"),
  flow("server", "llm", "cheap calls"),
  flow("admin", "door", "one draft"),
  flow("policy", "door", "limits", "limits"),
  flow("door", "client", "Apple Mail, Telegram, WhatsApp"),
];

/**
 * What passes between lanes (P81): the general view draws each lane as a box of its own and joins the lanes, not the blocks, so
 * Mermaid lays every lane out by itself and the lanes stay columns (a block linked out of its subgraph breaks that, decision
 * 0042). Every link between two lanes is one of these, and each of these carries at least one link (unit test).
 */
export interface LaneLink {
  from: LaneId;
  to: LaneId;
  label: string;
}
export const LANE_LINKS: readonly LaneLink[] = [
  { from: "in", to: "agent", label: "phrases, mail, files" },
  { from: "in", to: "hub", label: "your Send, linked chats" },
  { from: "agent", to: "reads", label: "reads, updates" },
  { from: "agent", to: "hub", label: "drafts, focus, every turn" },
  { from: "hub", to: "out", label: "one draft" },
];

export const CUT_IDS = ["mail-reply", "messenger-message", "session"] as const;
export type CutId = (typeof CUT_IDS)[number];
export interface Cut {
  id: CutId;
  title: string;
  /** One line under the cut's heading. */
  what: string;
  /** In order; the blocks are the links' ends in first appearance. */
  links: readonly Link[];
}

/** Three cuts, stacked under the general view: two straight chains and one fan-in. Same block ids, so the same dots. */
export const CUTS: readonly Cut[] = [
  {
    id: "mail-reply",
    title: "A mail reply",
    what: "From the client's mail to your Send: the agent drafts, you read the checks and send one draft.",
    links: [
      flow("mail", "rules", "mail filters"),
      flow("rules", "agent", "triage-mail"),
      flow("agent", "tools", "draft_write"),
      flow("tools", "admin", "Mail Drafts and app.db"),
      flow("admin", "you", "Mail"),
      flow("you", "policy", "I read the checks, Send"),
      flow("policy", "door", "passes"),
      flow("door", "client", "Apple Mail"),
    ],
  },
  {
    id: "messenger-message",
    title: "A messenger message",
    what: "A linked chat's message to your Send: the agent drafts by the chat's rules, you read it on the Messengers panel.",
    links: [
      flow("messengers", "server", "a linked chat"),
      flow("server", "agent", "messenger_history"),
      flow("agent", "tools", "messenger_draft_write, the chat's rules"),
      flow("tools", "admin", "a draft for the chat"),
      flow("admin", "you", "Messengers panel"),
      flow("you", "door", "Send, from P71 M4"),
      flow("door", "client", "Telegram, WhatsApp"),
    ],
  },
  {
    id: "session",
    title: "What a session is given",
    what: "Everything an agent session reads and is bound by; it never sends, deletes or forwards.",
    links: [
      flow("rules", "agent", "binds"),
      flow("skills", "agent", "the steps"),
      flow("mail", "agent", "mail-mcp, read only"),
      flow("knowledge", "agent", "knowledge_search"),
      flow("tools", "agent", "hub mcp"),
      flow("notion", "agent", "its own databases"),
      flow("google", "agent", "attached connectors"),
      flow("browser", "agent", "if set up"),
      flow("drops", "agent", "a file path"),
      flow("guard", "agent", "no send, delete, forward", "limits"),
      flow("agent", "log", "every turn"),
    ],
  },
];

/** Every live part's block. A kind missing here does not compile. */
export const BLOCK_OF: Record<SchemeKind, BlockId> = {
  core: "server",
  cli: "agent",
  session: "agent",
  notion: "notion",
  "notion-db": "notion",
  telegram: "messengers",
  whatsapp: "messengers",
  llm: "llm",
  "mail-app": "mail",
  mailbox: "mail",
  "mail-mcp": "mail",
  "hub-tools": "tools",
  knowledge: "knowledge",
  "mail-filters": "rules",
  setup: "rules",
  guard: "guard",
  "send-door": "door",
  calendar: "google",
  drive: "google",
};

/** A block's standing: the worst of its checked parts, and those parts that are not working. */
export type CheckedState = Exclude<SchemeState, "unknown">;
export interface BlockStanding {
  state: CheckedState;
  /** The parts at that state when it is not `ok`, in the server's order. */
  bad: readonly SchemeNode[];
}

const RANK: Record<CheckedState, number> = { fail: 0, warn: 1, ok: 2 };

/**
 * Each block's standing over every project's parts and the instance's (verdict 7: one view, the caption names the project). A
 * part "Not checked here" does not count, so a block whose parts are all unchecked, or that has none, has no standing: a plain box.
 */
export function blockStates(nodes: readonly SchemeNode[]): Partial<Record<BlockId, BlockStanding>> {
  const out: Partial<Record<BlockId, BlockStanding>> = {};
  for (const n of nodes) {
    if (n.state === "unknown") continue;
    const id = BLOCK_OF[n.kind];
    const was = out[id];
    if (!was || RANK[n.state] < RANK[was.state]) out[id] = { state: n.state, bad: n.state === "ok" ? [] : [n] };
    else if (was.state === n.state && n.state !== "ok") out[id] = { ...was, bad: [...was.bad, n] };
  }
  return out;
}

/** The counted second line of a block, else its fixed one. */
export function blockWhat(b: Block, nodes: readonly SchemeNode[]): string {
  const n = b.counted ? nodes.filter((x) => x.kind === b.counted?.kind).length : 0;
  return b.counted && n >= 2 ? b.counted.what(n) : b.what;
}

/**
 * The line under the drawing (the state is never a colour alone): "Broken: Send door (Send door, alpha). Needs a look: Agent
 * (Agent sessions)." The project is named only with two or more projects. Null when every checked part works.
 */
export function stateLine(nodes: readonly SchemeNode[]): string | null {
  const states = blockStates(nodes);
  const multi = new Set(nodes.flatMap((n) => (n.project ? [n.project] : []))).size > 1;
  const part = (n: SchemeNode) => (multi && n.project ? `${n.label}, ${n.project}` : n.label);
  const say = (state: CheckedState, word: string) => {
    const of = BLOCKS.flatMap((b) => {
      const s = states[b.id];
      return s?.state === state ? [`${b.label} (${s.bad.map(part).join("; ")})`] : [];
    });
    return of.length > 0 ? `${word}: ${of.join(", ")}.` : null;
  };
  const line = [say("fail", "Broken"), say("warn", "Needs a look")].filter(Boolean).join(" ");
  return line.length > 0 ? line : null;
}
