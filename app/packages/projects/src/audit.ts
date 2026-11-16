// Isolation audit of one session: which tools did it call, and did any call leave the project it was bound to?
// Works on a `claude -p --output-format stream-json` log and on a Claude Code session transcript (both are JSONL
// with `assistant` messages carrying `tool_use` blocks). Read only; nothing here talks to Mail or Notion.

export interface ToolCall {
  name: string;
  input: unknown;
  /** The tool's result when the log has it (a `tool_result` block); evidence audits need it, isolation audits ignore it. */
  result?: unknown;
}

const MAIL = "mcp__mail-mcp__";
const KNOWLEDGE = "mcp__knowledge-mcp__";
// Send, forward, reply (Gmail connector: sends; mail-mcp's `create_reply` only drafts), trash/delete (Notion, Gmail, mail),
// calendar cancel, and every outgoing-message writer of mail-mcp. `delete_draft` falls under delete.
const SEND_CAPABLE = /(^|[_-])(send|forward|reply[_-]?all|(create|replace|delete)[_-]outgoing|replace[_-]reply|trash|delete|cancel)([_-]|$)|^reply$/i;
/**
 * Where the guarded folders sit, as path prefixes without a trailing slash: relative to the session's folder (`projects` in an instance)
 * and/or absolute. A bare one-segment prefix (`projects`) only counts at the start of a path word, so `@projects/x` or
 * `/work/projects/x` of some other tree is not mistaken for it. The instance layout is the only one; the caller derives it from `hubPaths()`.
 */
export interface AuditLayout {
  projects: readonly string[];
  /** The live database file(s). */
  db: readonly string[];
}
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const prefixSource = (p: string) => (p.includes("/") ? (p.startsWith("/") ? "" : "\\b") : "(?<![A-Za-z0-9@._/~-])") + reEsc(p);
const alt = (ps: readonly string[]) => ps.map(prefixSource).join("|");
const SECRETS_STATE = "state\\/secrets";
function matchers(layout: AuditLayout) {
  const projects = alt(layout.projects);
  return {
    secrets: new RegExp(`${SECRETS_STATE}|${alt(layout.db)}`),
    // a projects folder listed or globbed rather than one named folder: `ls app/projects`, `app/projects/*`, `cd app/projects`
    listing: new RegExp(`(?:${projects})(\\/\\*|\\/?(?=[\\s"';|&)]|$))`),
    path: new RegExp(`(?:${projects})\\/([A-Za-z0-9][A-Za-z0-9._-]*)`, "g"),
    shown: layout.projects[0] ?? "projects",
  };
}
const MAIL_PROGRAMS = new Set(["osascript", "sendmail", "mail", "mailx", "swaks"]);
const SHELLS = new Set(["bash", "sh", "zsh"]);
/** True when a shell command RUNS a mail-sending program: the program name in command position, not a word inside a quoted payload (`echo '{"to":"robot@mail.x"}'`).
 *  `bash -c "<inner>"` is judged on the inner text. */
export function runsMailProgram(command: string, depth = 0): boolean {
  const inner: string[] = [];
  const bare = command.replace(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g, (_m, _q, body: string) => { inner.push(body); return " "; });
  for (const seg of bare.split(/;|&&|\|\||\||\n|`|\$\(|\(|\)/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) || ["sudo", "env", "command", "exec", "time", "nohup"].includes(words[i]!))) i++;
    const prog = (words[i] ?? "").replace(/^.*\//, "");
    if (MAIL_PROGRAMS.has(prog)) return true;
    if (SHELLS.has(prog) && depth < 2 && words.slice(i + 1).includes("-c") && inner.some((b) => runsMailProgram(b, depth + 1))) return true;
  }
  return false;
}
// `hub send ...` (the hub's sender, decision 0011) and a write of the owner's send settings: neither belongs to an agent session.
const HUB_SEND = /\bhub(?:\.mjs)?["']?\s+(?:\S+\s+){0,3}?send(?:\s|$)|installer\/src\/cli\.ts["']?\s+send(?:\s|$)/;
const SEND_SETTINGS = /\bsend\.(?:mode|classes|daily_cap|delay_minutes)\b/;
const PATH_KEYS = ["file_path", "path", "pattern", "command", "notebook_path"];

/** The hub's own skills (`hub`) and those the project's kind allows (`allowed`). A skill outside `hub` (a built-in or plugin skill) is not judged here. */
export interface SkillScope {
  allowed: readonly string[];
  hub: readonly string[];
}

/** Every tool call in a JSONL log, in order, with its result when a later `tool_result` block carries one. Lines that are not JSON, or carry no tool call, are ignored. */
export function toolCallsFromLog(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let j: any;
    try { j = JSON.parse(line); } catch { continue; }
    const content = Array.isArray(j?.message?.content) ? j.message.content : [];
    if (j?.type === "assistant") {
      for (const b of content) {
        if (b?.type === "tool_use" && typeof b.name === "string") {
          const c: ToolCall = { name: b.name, input: b.input };
          calls.push(c);
          if (typeof b.id === "string") byId.set(b.id, c);
        }
      }
    } else if (j?.type === "user") {
      for (const b of content) {
        if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
          const c = byId.get(b.tool_use_id);
          if (c) c.result = b.content;
        }
      }
    }
  }
  return calls;
}

/**
 * Violations of the project binding. `--allowedTools` names a tool, not its arguments, and mail-mcp is not
 * project-aware, so the binding is checked against the calls: a mail call naming an `account` outside the project,
 * a knowledge call naming another `project`, a send-capable tool, or a file access in another project's folder.
 * Folders starting with `_` (`_template`, `_archive`) are shared reference and allowed.
 */
export function auditToolCalls(calls: ReadonlyArray<ToolCall>, slug: string, accounts: readonly string[], skills: SkillScope | undefined, layout: AuditLayout): string[] {
  const m = matchers(layout);
  const ok = new Set(accounts.map((a) => a.trim().toLowerCase()));
  const out: string[] = [];
  for (const c of calls) {
    const short = c.name.split("__").pop() ?? c.name;
    const input = (c.input && typeof c.input === "object" ? c.input : {}) as Record<string, unknown>;
    if (c.name.startsWith(MAIL) && typeof input.account === "string" && !ok.has(input.account.trim().toLowerCase())) {
      out.push(`${short} used account "${input.account}" outside project ${slug}`);
    }
    if (skills && c.name === "Skill" && typeof input.skill === "string") {
      const name = input.skill.split(":").pop() ?? input.skill;
      if (skills.hub.includes(name) && !skills.allowed.includes(name)) out.push(`skill ${name} is not in the skill list of project ${slug}'s kind`);
    }
    if (c.name.startsWith(KNOWLEDGE) && typeof input.project === "string" && input.project !== slug) {
      out.push(`${short} named project "${input.project}" in a ${slug} run`);
    }
    if (SEND_CAPABLE.test(c.name) || SEND_CAPABLE.test(short)) out.push(`${short} is a send-capable tool (drafts only, nothing may be sent)`);
    if (typeof input.command === "string" && HUB_SEND.test(input.command)) out.push(`${short} runs hub send (only a person or the hub's own runner sends; the agent never does)`);
    const written = [input.command, input.new_string, input.content, ...(Array.isArray(input.edits) ? input.edits.map((e) => (e as { new_string?: unknown })?.new_string) : [])];
    if (written.some((w) => typeof w === "string" && SEND_SETTINGS.test(w))) out.push(`${short} writes a send.* setting (switching sending on is the owner's step)`);
    for (const k of PATH_KEYS) {
      const v = input[k];
      if (typeof v !== "string") continue;
      if (m.secrets.test(v)) out.push(`${short} touched secrets or the live database (${k}: ${v.slice(0, 80)})`);
      if (m.listing.test(v)) out.push(`${short} listed or globbed ${m.shown} instead of naming ${slug} (${k}: ${v.slice(0, 80)})`);
      if (k === "command" && runsMailProgram(v)) out.push(`${short} runs a mail-sending program (drafts only)`);
      for (const hit of v.matchAll(m.path)) {
        const other = hit[1]!;
        if (other !== slug && !other.startsWith("_")) out.push(`${short} touched ${m.shown}/${other} in a ${slug} run`);
      }
    }
  }
  return out;
}
