import { LOCAL_ACTION_IDS, LOCAL_ACTIONS, isLocalAction } from "@hub/contract/local";
import { isRefusal, LOCAL_OPEN_UNAVAILABLE, openTarget, resolveTarget, type OpenRun, type ResolveDeps } from "@hub/projects/local-open";

// `hub open` (P61): the owner's own terminal runs the same registry and resolver as the admin's Open buttons. It prints the
// path it opened (this is his terminal, not a reply on the wire). Never the agent's: `hub open` and a bare `open` are in
// the deny rules and Codex's forbidden prefixes (`@hub/agent/deny`).

export interface OpenCommandDeps {
  out: (line: string) => void;
  /** Built lazily: listing the actions needs no instance. */
  resolver: () => ResolveDeps;
  run: OpenRun;
  available: boolean;
  /**
   * P58 R1, `--draft <id>`: the hub draft's two Message-IDs, read for this project: `mailRef` (the client's message, from the
   * row) and `draft` (the Mail draft's own, from one strict Mail read; null with `why` when Mail does not hold exactly one).
   * Injected, so `@hub/projects` never imports `@hub/send`. Absent: `--draft` is refused.
   */
  draftIds?: (project: string | undefined, draftId: number) => Promise<{ mailRef: string | null; draft: string | null; why: string | null }>;
}

export interface OpenFlags {
  project?: string;
  key?: string;
  tab?: string;
  /** An `href` action's arguments as JSON (`--args '{"messageId":"..."}'`). */
  args?: string;
  /** P58 R1: `mail.openDraft` / `mail.openMessage` of this hub draft (its id), instead of `--args`. */
  draft?: string;
}

/** Exit codes: 0 opened or listed, 2 refused, unknown, or not macOS. */
export async function runOpenCommand(action: string | undefined, f: OpenFlags, d: OpenCommandDeps): Promise<number> {
  if (!action) {
    const w = Math.max(...LOCAL_ACTION_IDS.map((a) => a.length));
    for (const id of LOCAL_ACTION_IDS) {
      const a = LOCAL_ACTIONS[id];
      d.out(`${id.padEnd(w)}  ${a.transport.padEnd(6)}  ${a.label}${"offered" in a && a.offered === false ? `  (${a.refusal})` : ""}`);
    }
    d.out("server actions take --project <slug> --key <key>: project, project.md, knowledge, knowledge:<entry>, workflows, log:<YYYY-MM-DD>");
    d.out("mail.openDraft and mail.openMessage take --draft <id> (the hub draft; --project or HUB_PROJECT): its Mail draft, or the client's mail");
    return 0;
  }
  if (!isLocalAction(action)) {
    d.out(`unknown action "${action}"; actions: ${LOCAL_ACTION_IDS.join(", ")}`);
    return 2;
  }
  const def = LOCAL_ACTIONS[action];
  if ("offered" in def && def.offered === false) {
    d.out(`refused: ${def.refusal}`);
    return 2;
  }
  if (!d.available) {
    d.out(`hub open needs macOS (open(1)): ${LOCAL_OPEN_UNAVAILABLE}`);
    return 2;
  }
  let args: unknown;
  if (f.draft !== undefined && (action === "mail.openDraft" || action === "mail.openMessage")) {
    const id = Number(f.draft);
    if (!Number.isInteger(id) || id <= 0) {
      d.out("refused: --draft takes a draft id");
      return 2;
    }
    if (!d.draftIds) {
      d.out("refused: --draft is not available here");
      return 2;
    }
    const ids = await d.draftIds(f.project, id);
    const messageId = action === "mail.openDraft" ? ids.draft : ids.mailRef;
    if (!messageId) {
      d.out(`refused: ${ids.why ?? (action === "mail.openDraft" ? "Mail holds no single draft for it" : "the draft answers no Mail message")}`);
      return 2;
    }
    args = { messageId };
  } else if (f.draft !== undefined) {
    d.out("refused: --draft goes with mail.openDraft or mail.openMessage");
    return 2;
  } else if (def.transport === "href") {
    try {
      args = JSON.parse(f.args ?? "{}");
    } catch {
      d.out("refused: --args is not JSON");
      return 2;
    }
  } else args = action === "agent.openInDesktop" ? { project: f.project, tab: f.tab } : { project: f.project, key: f.key };
  const target = await resolveTarget(action, args, d.resolver());
  if (isRefusal(target)) {
    d.out(`refused: ${target.refused}`);
    return 2;
  }
  try {
    await openTarget(target, d.run);
  } catch (e) {
    d.out(`refused: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  d.out(`opened: ${target.label}  ${target.kind === "path" ? target.path : target.url}`);
  return 0;
}
