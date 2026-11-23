import { CLIENTS, DRAFTED, FIXTURE_PROJECT, replyBody, type FixtureClient } from "./fixture";

// Builds the tool-call sequences of a session over the fixture, as Claude Code writes them to a transcript (assistant
// `tool_use` lines, user `tool_result` lines). Offline and deterministic: nothing here talks to mail or Notion. The five
// committed transcripts in fixtures/transcripts/ are the output of `transcriptFiles()`; a test keeps them in sync.

export interface Step { name: string; input: Record<string, unknown>; result: unknown }

const ACCOUNT = "desk@fixture-pc.example";
const MAIL = "mcp__mail-mcp__";
const text = (t: string) => [{ type: "text", text: t }];

export function readsFor(c: FixtureClient, n: number): Step[] {
  const ids = c.found ? c.ids : c.ids; // first contact: the message to answer is ids[0]
  return ids.slice(0, Math.max(1, n)).map((id, k) => ({
    name: `${MAIL}get_message_content`,
    input: { account: ACCOUNT, mailboxPath: ["INBOX"], message_id: id },
    result: text(JSON.stringify({ id, from: `${c.name} <${c.email}>`, date: `2026-11-0${1 + k}`, subject: "Re: your property", body: `(thread text about ${c.needles[0]})` })),
  }));
}

export const findFor = (c: FixtureClient): Step => ({
  name: `${MAIL}find_messages`,
  input: { account: ACCOUNT, mailboxPath: ["INBOX"], sender: c.email },
  result: text(JSON.stringify(c.found === 0 ? [] : c.ids.map((id, k) => ({ id, sender: c.email, date: `2026-11-0${1 + k}` })))),
});
export const profileFor = (c: FixtureClient): Step => ({
  name: "mcp__notion__notion-query-data-sources",
  input: { data_source_url: "collection://clients", query: `Email = ${c.email}` },
  result: text(c.profile === "absent" ? "[]" : JSON.stringify([{ email: c.email, summary: c.profile === "empty" ? "" : "durable facts", last_edited_time: c.profileEdited ?? "2026-11-01" }])),
});
export const factsFor = (c: FixtureClient): Step => ({ name: "mcp__hub__knowledge_search", input: { query: c.needles[0] }, result: text("[]") });
/** mail-mcp's own reply writer, as older transcripts hold it: a draft nobody recorded (the lazy and brief-less sessions). */
export const replyFor = (c: FixtureClient, body = replyBody(c)): Step => ({
  name: `${MAIL}create_reply`,
  input: { account: ACCOUNT, mailbox_path: ["INBOX"], message_id: c.ids[0], content: body },
  result: text("Outgoing Message ID: 9000"),
});

export function contextFor(c: FixtureClient, over: { read?: number; batchKey?: string } = {}) {
  const read = over.read ?? Math.min(c.found, 3);
  const readIds = c.ids.slice(0, c.found === 0 ? 0 : read).map(String);
  return {
    batchKey: over.batchKey ?? "bulk-fixture-1",
    thread: { firstContact: c.found === 0, found: c.found, read: c.found === 0 ? 0 : read, readIds, cited: c.found === 0 ? [] : readIds.slice(0, 1), newest: c.newest },
    profile: { read: true, state: c.profile, ...(c.profileEdited ? { editedAt: c.profileEdited } : {}) },
    facts: { queries: 1, used: [], missing: [] },
    anchors: [`${c.needles[0]}`.slice(0, 120).padEnd(12, ".")],
    personalization: `Answers ${c.name} about ${c.needles[0]} and ${c.needles[1]}, which only this thread mentions.`,
    ...(c.profile !== "filled" ? { gaps: ["profile-empty"] } : {}),
  };
}

/**
 * The hub's `draft_write` of the reply with the record it carries (P129 A3, decision 0045 point 10): one call writes the
 * draft in Mail and records it, so the audit's claim is the call's own `record.context` (`claimOfDraftWrite`), no shell step.
 */
export const writeFor = (c: FixtureClient, ctx: unknown = contextFor(c), body = replyBody(c)): Step => ({
  name: "mcp__hub__draft_write",
  input: { kind: "reply", message: { account: ACCOUNT, mailbox_path: ["INBOX"], message_id: c.ids[0] }, content: body, record: { name: c.name, skill: "bulk-drafts", context: ctx } },
  result: text(JSON.stringify({ draftId: 9000, thread: `m${c.ids[0]}@clients.example`, replyTo: c.ids[0], account: ACCOUNT, sent: false, recorded: true })),
});

/** The careful sequence for one client: profile, history, opened messages, facts, the draft with its record. */
export function carefulSteps(c: FixtureClient, o: { read?: number } = {}): Step[] {
  return [profileFor(c), findFor(c), ...readsFor(c, o.read ?? Math.min(Math.max(c.found, 1), 3)), factsFor(c), writeFor(c, contextFor(c, o.read !== undefined ? { read: o.read } : {}))];
}

/** One agent that opens only the newest message and then drafts everyone (the shortcut of failure mode F5/F6). */
export function lazySteps(cs: readonly FixtureClient[]): Step[] {
  return [findFor(cs[0]!), ...readsFor(cs[0]!, 1), ...cs.map((c) => replyFor(c))];
}

/** One template with the name swapped, with every read present: the body, not the reads, is the defect (F3/F6). */
export function templateLoopSteps(cs: readonly FixtureClient[]): Step[] {
  return cs.flatMap((c) => {
    const body = `Hi ${c.name.split(" ")[0]},\n\nThank you for your message and for your patience. We have received your question and our team is reviewing the details of your property. We will come back to you in the next few days with the information you need. In the meantime, please do not hesitate to contact us if anything changes or if you have further questions about the process.\n\nKind regards, the desk`;
    return [profileFor(c), findFor(c), ...readsFor(c, Math.min(Math.max(c.found, 1), 3)), factsFor(c), writeFor(c, contextFor(c), body)];
  });
}

/** Claims three messages read while the session opened one. */
export function claimExceedsSteps(c: FixtureClient): Step[] {
  return [profileFor(c), findFor(c), ...readsFor(c, 1), factsFor(c), writeFor(c, contextFor(c, { read: 3 }))];
}

let seq = 0;
export function toJsonl(steps: readonly Step[], tag = "t"): string {
  const lines: string[] = [];
  for (const s of steps) {
    const id = `toolu_${tag}${String(++seq).padStart(4, "0")}`;
    lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name: s.name, input: s.input }] } }));
    lines.push(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: s.result }] } }));
  }
  return lines.join("\n") + "\n";
}

/** The five committed transcripts. A subagent folder is `{ main, subagents: { id: text } }`. */
export function transcriptFiles(): Record<string, string> {
  seq = 0;
  const three = DRAFTED.slice(0, 3);
  return {
    "good-3.jsonl": toJsonl(three.flatMap((c) => carefulSteps(c)), "g"),
    "bad-no-reads.jsonl": toJsonl(lazySteps(three), "n"),
    "bad-template-loop.jsonl": toJsonl(templateLoopSteps(DRAFTED.slice(0, 4)), "l"),
    "bad-claim-exceeds.jsonl": toJsonl(claimExceedsSteps(CLIENTS[2]!), "c"),
    // bad-subagent-brief: the main session only dispatches; subagent 1 follows the procedure, subagent 2 got a brief without it
    "bad-subagent-brief.main.jsonl": toJsonl([{ name: "Agent", input: { description: "client 1" }, result: text("done") }], "m"),
    "bad-subagent-brief.sub-a1.jsonl": toJsonl(carefulSteps(CLIENTS[0]!), "a"),
    "bad-subagent-brief.sub-a2.jsonl": toJsonl([replyFor(CLIENTS[1]!)], "b"),
  };
}
