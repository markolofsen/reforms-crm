import type { FocusPost } from "@hub/contract/focus";

const SCREEN: Record<string, string> = { drafts: "the Drafts list", draft: "a draft", "follow-ups": "Follow-ups", activity: "Activity", run: "a run", project: "Project", connections: "Connections", overview: "Overview", other: "nothing current" };

/** The dock header's line (P51): what the agent resolves "this draft" and "the selected ones" to. */
export function agentSeesLine(f: FocusPost | null): string {
  if (!f) return "Agent sees: nothing current";
  const what = f.draftId ? `draft ${f.draftId}` : (SCREEN[f.screen] ?? "nothing current");
  return `Agent sees: ${what}${f.selected.length ? ` · ${f.selected.length} selected` : ""}`;
}
