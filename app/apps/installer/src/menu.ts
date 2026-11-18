import * as p from "@clack/prompts";
import type { AgentCli } from "@hub/config/paths";
import { CLI_LABELS } from "@hub/agent/session";
import { PHRASES } from "./agent";
import { c } from "./term";

type Action = "agent" | "up" | "doctor" | "filters";

const FILTER_ACTIONS = [
  { value: "check", label: "check", hint: "validate the rules file" },
  { value: "propose", label: "propose", hint: "rules from a sender sample" },
  { value: "export-xml", label: "export-xml", hint: "Gmail mailFilters.xml" },
  { value: "export-api", label: "export-api", hint: "API request list" },
];

const cancelled = <T>(v: T | symbol): v is symbol => p.isCancel(v);

/** The interactive menu. Returns the argv of the chosen command (parsed by the same CLI), or null when the user leaves. */
export async function runMenu(projects: string[], defaultCli: AgentCli = "claude"): Promise<string[] | null> {
  p.intro(c.bold(c.cyan(" hub ")) + c.dim(" Hub Workflow"));
  const action = await p.select<Action>({
    message: "What do you want to do?",
    options: [
      { value: "agent", label: "Agent session", hint: "Claude Code or Codex, bound to a project" },
      { value: "up", label: "Admin", hint: "review drafts in the local admin (`hub up --demo` for invented data)" },
      { value: "doctor", label: "Check", hint: "health check of the setup or of one project" },
      { value: "filters", label: "Mail filters", hint: "Gmail filters for a project" },
    ],
  });
  if (cancelled(action)) return leave();

  const projectChoice = async (message: string, extra: { value: string; label: string; hint?: string }[]): Promise<string | null> => {
    const v = await p.select<string>({
      message,
      options: [...extra, ...projects.map((s) => ({ value: `project:${s}`, label: s }))],
    });
    return cancelled(v) ? null : v;
  };

  switch (action) {
    case "agent": {
      const v = await projectChoice("Session for", [
        { value: "continue", label: "Continue the last session", hint: "a fresh one if none" },
        { value: "pick", label: "Pick a session from the list" },
        { value: "new", label: "New session, no project", hint: "the phrase names the project" },
      ]);
      if (v === null) return leave();
      // The same list as the terminal's `+`: the instance's default (`agent.default`) first.
      const order: AgentCli[] = defaultCli === "codex" ? ["codex", "claude"] : ["claude", "codex"];
      const cli = await p.select<AgentCli>({ message: "With", options: order.map((x, i) => ({ value: x, label: CLI_LABELS[x], ...(i === 0 ? { hint: "default" } : {}) })) });
      if (cancelled(cli)) return leave();
      p.note(PHRASES.map(([ph]) => ph).join("\n"), "Then say one of");
      p.outro(c.dim(`starting ${CLI_LABELS[cli]}`));
      return ["agent", v.startsWith("project:") ? v.slice(8) : v, "--cli", cli];
    }
    case "doctor": {
      const v = await projectChoice("Check", [{ value: "all", label: "Everything (setup)" }]);
      if (v === null) return leave();
      return v === "all" ? ["doctor"] : ["doctor", v.slice(8)];
    }
    case "filters": {
      if (!projects.length) { p.log.error("no projects yet: `hub agent new`, then say \"настрой проект <имя>\""); return null; }
      const slug = await p.select<string>({ message: "Project", options: projects.map((s) => ({ value: s, label: s })) });
      if (cancelled(slug)) return leave();
      const act = await p.select<string>({ message: "Action", options: FILTER_ACTIONS });
      if (cancelled(act)) return leave();
      const extra: string[] = [];
      if (act === "propose") {
        const f = await p.text({ message: "Sender sample (JSON file)", validate: (x) => (x?.trim() ? undefined : "a file is required") });
        if (cancelled(f)) return leave();
        extra.push("--sample", f.trim());
      }
      return ["mail-filters", slug, act, ...extra];
    }
    case "up":
      p.outro(c.dim("Ctrl-C stops the admin"));
      return ["up"];
  }
}

function leave(): null { p.cancel("bye"); return null; }
