import { inspect, isTelegramToken, notionShapeProblem, NOTION_FILE, storeToken, TELEGRAM_FILE, testConnection, type ConnectionRow, type ProbeDeps, type ProjectUse, type Verdict } from "@hub/connections";
import { loadProjects } from "@hub/projects";
import type { Ctx } from "./context";

/** What each project says about connections, read from the instance's project.md files. */
export const projectUses = (ctx: Ctx): ProjectUse[] =>
  loadProjects(ctx.paths.projects).map((p) => ({ slug: p.slug, notionTokenFile: p.parsed.config.notion.tokenFile }));

export interface ConnectionsReport { rows: ConnectionRow[]; verdicts: Map<string, Verdict>; exitCode: number }

const cell = (s: string | undefined | null): string => (s && s.length ? s : "-");
const BROKEN = new Set(["unsafe-mode", "malformed"]);

/**
 * `hub connections`: the same rows the admin shows (one `inspect`), read from files only. `--test` also runs the probes, which is the only
 * network use; the probes read the secrets inside this process and print no value. Exit 1 when a file is loose or unusable, or a probe was refused.
 */
export async function connectionsReport(ctx: Ctx, o: { test: boolean; deps: ProbeDeps }): Promise<ConnectionsReport> {
  const rows = inspect({ dir: ctx.configDir, env: process.env, projects: projectUses(ctx) });
  const verdicts = new Map<string, Verdict>();
  if (o.test) for (const r of rows) if (r.can.includes("test")) verdicts.set(r.id, await testConnection(ctx.configDir, process.env, o.deps, r.id));
  const bad = rows.some((r) => BROKEN.has(r.secret.state)) || [...verdicts.values()].some((v) => v.state === "invalid");
  return { rows, verdicts, exitCode: bad ? 1 : 0 };
}

export function connectionsTable(rep: ConnectionsReport): string {
  const head = ["CONNECTION", "SECRET", "IDENTITY", "USED BY", ...(rep.verdicts.size ? ["TEST"] : [])];
  const body = rep.rows.map((r) => {
    const v = rep.verdicts.get(r.id);
    return [r.id, r.secret.state, cell(r.identity), cell(r.usedBy.join(", ")), ...(rep.verdicts.size ? [v ? `${v.state}: ${v.detail}` : "-"] : [])];
  });
  const all = [head, ...body];
  const w = head.map((_, i) => Math.max(...all.map((l) => (l[i] ?? "").length)));
  return all.map((l) => l.map((c, i) => (i === l.length - 1 ? c : c.padEnd(w[i] ?? 0))).join("  ")).join("\n");
}

export type TokenName = "notion" | "telegram";
export const TOKEN_NAMES: readonly TokenName[] = ["notion", "telegram"];

/** `hub token <name>`: stores one token alone in its file (mode 600). A value of the wrong shape is refused and nothing is written. Returns the file path. */
export function storeNamedToken(ctx: Ctx, name: TokenName, value: string): string {
  const v = value.trim();
  if (!v) throw new Error("empty token, nothing stored");
  if (name === "telegram" && !isTelegramToken(v)) throw new Error("not a Telegram bot token (expected <digits>:<secret>); nothing stored");
  const bad = name === "notion" ? notionShapeProblem(v) : undefined;
  if (bad) throw new Error(`${bad}; nothing stored`);
  return storeToken(ctx.configDir, name === "notion" ? NOTION_FILE : TELEGRAM_FILE, v);
}
