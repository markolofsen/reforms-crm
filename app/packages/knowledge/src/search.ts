// The tool contract of doc 16 section 5, as plain functions. The MCP server only adapts these.
import { HubError, type ErrorKind } from "@hub/config/errors";
import { RepoError, type Repos } from "@hub/db";
import { ANY_BRAND } from "@hub/projects/brand";
import { ProjectBase } from "@hub/projects/model";

export type ToolErrorCode = "unknown_project" | "project_mismatch" | "empty_query" | "not_found" | "brand_required" | "unknown_brand";
const TOOL_KINDS: Readonly<Record<ToolErrorCode, ErrorKind>> = { unknown_project: "not_found", project_mismatch: "forbidden", empty_query: "invalid", not_found: "not_found", brand_required: "invalid", unknown_brand: "invalid" };

/** A knowledge tool's refusal (its MCP server and CLI answer with `code`). */
export class ToolError extends HubError {
  declare readonly code: ToolErrorCode;
  constructor(code: ToolErrorCode, message: string) {
    super(TOOL_KINDS[code], code, message);
    this.name = "ToolError";
  }
}

export interface ToolEnv {
  /** HUB_PROJECT: when set, every call must name this project. */
  hubProject?: string | undefined;
  /** Injectable clock (YYYY-MM-DD) for valid_until. */
  today?: string;
}

export const BODY_CAP = 12_000;
export const QUERY_MAX = 300;

export interface SearchArgs {
  project: string;
  query: string;
  audience?: string | undefined;
  /** P60: required in a `knowledge.scope by-brand` project (the brand `mail_brand` gave, or `ANY` for an unbranded mail); ignored in a `shared` one. */
  brand?: string | undefined;
  limit?: number | undefined;
  include?: "approved" | "all" | undefined;
}

export interface SearchResult {
  project: string;
  query: string;
  total: number;
  truncated: boolean;
  results: Array<{
    path: string;
    title: string;
    snippet: string;
    use: "STATE" | "MARKER";
    approved: boolean;
    expired: boolean;
    audiences: string[];
    brands: string[];
    category: string | null;
    valid_until: string | null;
    score: number;
  }>;
}

export interface GetResult {
  path: string;
  front_matter: Record<string, unknown>;
  body: string;
  truncated: boolean;
}

function bind(project: string, env: ToolEnv): void {
  if (env.hubProject && env.hubProject !== project) {
    throw new ToolError("project_mismatch", `project_mismatch: this server is bound to "${env.hubProject}", the call named "${project}"`);
  }
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RepoError && (err.code === "unknown_project" || err.code === "empty_query")) throw new ToolError(err.code, err.message);
    throw err;
  }
}

export function knowledgeSearch(repos: Repos, args: SearchArgs, env: ToolEnv = {}): Promise<SearchResult> {
  bind(args.project, env);
  return guard(async () => {
    if (args.query.trim() === "") throw new ToolError("empty_query", "empty_query: the query is empty");
    const brand = await brandFilter(repos, args.project, args.brand);
    const { total, hits } = await repos.knowledge.search(args.project, args.query.slice(0, QUERY_MAX), {
      ...(args.audience ? { audience: args.audience } : {}),
      ...(brand ? { brand } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.include ? { include: args.include } : {}),
      ...(env.today ? { today: env.today } : {}),
    });
    return {
      project: args.project,
      query: args.query,
      total,
      truncated: total > hits.length,
      results: hits.map((h) => ({
        path: h.path,
        title: h.title,
        snippet: h.snippet,
        use: h.use,
        approved: h.approved,
        expired: h.expired,
        audiences: h.audiences,
        brands: h.brands,
        category: h.category,
        valid_until: h.validUntil,
        score: h.score,
      })),
    };
  });
}

/**
 * The brand to filter by (P60): none in a `shared` project; in a `by-brand` one the argument is required and must be a
 * `## Brands` name (case-insensitive, returned in the table's spelling) or `ANY`. Read from the synced registry row.
 */
async function brandFilter(repos: Repos, project: string, brand: string | undefined): Promise<string | undefined> {
  const row = await repos.projects.get(project);
  if (!row) return undefined; // the search itself reports unknown_project
  const parsed = ProjectBase.safeParse(JSON.parse(row.settingsJson));
  if (!parsed.success || parsed.data.knowledge.scope !== "by-brand") return undefined;
  const names = parsed.data.brands.map((b) => b.name);
  if (!brand?.trim()) throw new ToolError("brand_required", `brand_required: project "${project}" keeps each brand's facts apart (knowledge.scope by-brand): pass brand = the brand mail_brand gave (${names.join(", ")}), or ${ANY_BRAND} for a mail with no brand`);
  if (brand.trim() === ANY_BRAND) return ANY_BRAND;
  const hit = names.find((n) => n.toLowerCase() === brand.trim().toLowerCase());
  if (!hit) throw new ToolError("unknown_brand", `unknown_brand: "${brand}" is not a brand of "${project}" (${names.join(", ")}, or ${ANY_BRAND})`);
  return hit;
}

export function knowledgeGet(repos: Repos, args: { project: string; path: string }, env: ToolEnv = {}): Promise<GetResult> {
  bind(args.project, env);
  return guard(async () => {
    const row = await repos.knowledge.get(args.project, args.path);
    if (!row) throw new ToolError("not_found", `not_found: no entry "${args.path}" in project "${args.project}"`);
    return {
      path: row.path,
      front_matter: JSON.parse(row.frontMatter) as Record<string, unknown>,
      body: row.body.length > BODY_CAP ? row.body.slice(0, BODY_CAP) : row.body,
      truncated: row.body.length > BODY_CAP,
    };
  });
}
