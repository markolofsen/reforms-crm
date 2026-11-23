import { afterEach, describe, expect, it } from "vitest";
import { pathsAt } from "@hub/config/paths";
import { appendEvents, logStoreOf } from "@hub/log/store";
import { projectStore } from "@hub/projects";
import { recordPost } from "@hub/agent/evidence/store";
import { fakePorts, REPLAY_CASES, replay, type FakePorts, type ReplayGuard, type ReplayObserver } from "@hub/agent/testing";
import { auditLayout, guardDecision, preDraftViolations } from "../src/safety";

// P129 verdict 10 (A7): the replay with the REAL guard. Each documented call of a case passes `guardDecision` (block mode, the
// project's accounts) and `preDraftViolations` (the evidence rule and the owner's words, verdict 7) before the real tool runs on
// fake ports, and the PostToolUse ledger records it after, as the hooks do in a session. No violation, no unexpected refusal.

let open: FakePorts[] = [];
afterEach(() => {
  for (const p of open) p.close();
  open = [];
});

const guard: ReplayGuard = (call, p) => {
  const paths = pathsAt(p.dir);
  const payload = { session_id: call.sessionId, tool_name: call.name, tool_input: call.input };
  const accounts = projectStore({ projects: p.projectsDir }).config(p.slug).mail.accounts;
  const g = guardDecision(payload, { slug: p.slug, accounts, mode: "block", layout: auditLayout(paths), unattended: false });
  return [...g.violations, ...preDraftViolations(payload, p.dir, p.slug, p.dbPath, paths)];
};
const observe: ReplayObserver = (call, p) => void recordPost(p.dir, p.slug, { session_id: call.sessionId, tool_name: call.name, tool_input: call.input, tool_response: call.result });

describe("replay with the real guard (P129 verdict 10)", () => {
  for (const c of REPLAY_CASES) {
    it(c.title, async () => {
      const p = fakePorts(c.ports);
      open.push(p);
      // The guard reads the owner's words from the instance's own session log (the prompt hook writes it), on the real clock.
      appendEvents(logStoreOf(pathsAt(p.dir)), [{ project: p.slug, session: "replay", cli: "claude", kind: "prompt", data: { text: c.prompt } }]);
      const r = await replay(c, p, { guard, observe });
      expect(r.violations).toEqual([]);
      expect(r.unexpected, JSON.stringify(r.results)).toEqual([]);
      expect(r.drafts).toEqual([...c.drafts].sort((a, b) => a.email.localeCompare(b.email)));
    });
  }
});
