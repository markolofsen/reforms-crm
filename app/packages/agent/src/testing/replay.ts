import { connect, type FakePorts, type FakePortsOptions } from "./ports";

// The replay harness (P129 verdict 10, P18 E6, the offline half). A case is the owner's prompt and the tool calls a skill
// documents for it, with canned answers for the servers that are not the hub's (mail-mcp, Notion). The runner logs the prompt,
// passes every call through the guard it is given (the installer injects the real `guardDecision` and `preDraftViolations`;
// `@hub/agent` cannot import the installer), runs the hub's calls against the real tools on fake ports, and returns every
// violation, every refusal and the results. No model runs: it proves the documented path is executable, not that a model picks it.

export interface ReplayStep {
  /** The full tool name as a session calls it: `mcp__hub__draft_write`, `mcp__mail-mcp__find_messages`, `Read`, ... */
  name: string;
  /** The arguments, or a function of the results of the steps before (an id a seed or an earlier call returned). */
  input: Record<string, unknown> | ((ctx: ReplayContext) => Record<string, unknown>);
  /** The canned answer of a call that is not the hub's (shaped from the session log, kept minimal). */
  result?: unknown;
  /** The refusal code this step must get (the documented answer, e.g. `already_sent`); absent: it must not refuse. */
  refusal?: string;
}

export interface ReplayContext {
  /** What `setup` returned (seeded ids). */
  seed: Record<string, number | string>;
  /** The JSON answer of each step so far, by index. */
  results: unknown[];
}

export interface ReplayCase {
  title: string;
  /** The owner's words, as he typed them in the dock (logged first, as the prompt hook does). */
  prompt: string;
  /** Options of `fakePorts` this case needs (test mode, the Notion table). */
  ports?: FakePortsOptions;
  /** Seeds the fake Mail and the database; returns ids the steps use. */
  setup?: (p: FakePorts) => Promise<Record<string, number | string>>;
  steps: ReplayStep[];
  /** The Hub rows after the run: one per client of the project, its address and its newest draft's status. */
  drafts: Array<{ email: string; status: string }>;
}

/** The guard as the installer's hook applies it: the violations of one call (empty: allowed). */
export type ReplayGuard = (call: { name: string; input: Record<string, unknown>; sessionId: string }, p: FakePorts) => string[] | Promise<string[]>;
/** What the PostToolUse hook does with a finished call (the installer writes the session ledger with it). */
export type ReplayObserver = (call: { name: string; input: Record<string, unknown>; result: unknown; sessionId: string }, p: FakePorts) => void | Promise<void>;

export interface ReplayOutcome {
  violations: Array<{ step: number; name: string; violations: string[] }>;
  /** Refusals no step expected, and expected ones that did not come. */
  unexpected: Array<{ step: number; name: string; got: string | null; want: string | null }>;
  results: unknown[];
  drafts: Array<{ email: string; status: string }>;
}

export const REPLAY_SESSION = "replay";

export async function replay(c: ReplayCase, p: FakePorts, o: { guard?: ReplayGuard; observe?: ReplayObserver } = {}): Promise<ReplayOutcome> {
  const seed = c.setup ? await c.setup(p) : {};
  p.prompt(c.prompt);
  const hub = await connect(p);
  const out: ReplayOutcome = { violations: [], unexpected: [], results: [], drafts: [] };
  for (const [i, s] of c.steps.entries()) {
    const input = typeof s.input === "function" ? s.input({ seed, results: out.results }) : s.input;
    const violations = o.guard ? await o.guard({ name: s.name, input, sessionId: REPLAY_SESSION }, p) : [];
    if (violations.length) out.violations.push({ step: i, name: s.name, violations });
    let result: unknown = s.result;
    let got: string | null = null;
    if (s.name.startsWith("mcp__hub__")) {
      const r = await hub.call(s.name.slice("mcp__hub__".length), input);
      result = r.json;
      got = r.isError ? String(r.json.error ?? "error") : null;
    }
    if (got !== (s.refusal ?? null)) out.unexpected.push({ step: i, name: s.name, got, want: s.refusal ?? null });
    out.results.push(result);
    // The hook sees an MCP reply: a hub tool's JSON wrapped as its text content, an external step's recorded reply as written.
    const reply = s.name.startsWith("mcp__hub__") ? { content: [{ type: "text", text: JSON.stringify(result ?? null) }] } : (s.result ?? { content: [] });
    if (o.observe) await o.observe({ name: s.name, input, result: reply, sessionId: REPLAY_SESSION }, p);
  }
  await hub.client.close();
  out.drafts = (await p.repos.clients.list(p.slug)).filter((r) => r.draft).map((r) => ({ email: r.email, status: String(r.draft?.status) })).sort((a, b) => a.email.localeCompare(b.email));
  return out;
}
