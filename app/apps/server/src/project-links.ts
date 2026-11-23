import { join } from "node:path";
import { hrefOf } from "@hub/contract/local";
import { projectLinksDto, type ProjectLinksDto } from "@hub/contract/responses";
import { loadProject } from "@hub/projects";
import { createNotionReader, loadToken, secretsDir, type NotionReader } from "@hub/notion";
import type { Repos } from "@hub/db";

type NotionState = ProjectLinksDto["notion"]["state"];

const notionTarget = (target: string): string | null => (target.startsWith("notion:") ? target.slice("notion:".length) : null);

const statusMessage = (state: NotionState): string | null => {
  if (state === "missing_token") return "Notion token is not configured for this project";
  if (state === "unresolved") return "Notion database page is not available for this link";
  if (state === "error") return "Notion could not resolve one or more links";
  return null;
};

export interface ProjectLinksOptions {
  /** Tests and embedded callers may provide the already-authorized read-only reader. */
  reader?: NotionReader;
  env?: NodeJS.ProcessEnv;
}

/** Resolves a project's declared links without exposing credentials or adding a Notion write path. */
export async function projectLinks(repos: Repos, slug: string, root: string, options: ProjectLinksOptions = {}): Promise<ProjectLinksDto> {
  const row = await repos.projects.get(slug);
  if (row === null) throw new Error(`no such project "${slug}"`);
  const project = loadProject(root, slug);
  const declared = project.parsed.config.links;
  const roles = [
    ...new Set(
      declared
        .map((link) => notionTarget(link.target))
        .filter((target): target is string => !!target && !/^[0-9a-f]{32}$/i.test(target) && /^[a-z0-9][a-z0-9_-]*$/.test(target)),
    ),
  ];
  let reader = options.reader;
  let notionState: NotionState = "ready";

  if (roles.length && !reader) {
    const tokenFile = project.parsed.config.notion.tokenFile;
    try {
      const token = await loadToken(tokenFile === "notion-token" ? options.env : { ...(options.env ?? process.env), NOTION_TOKEN: "" }, join(secretsDir(options.env), tokenFile));
      reader = createNotionReader(token);
    } catch {
      notionState = "missing_token";
    }
  }

  const databasePages = new Map<string, string>();
  if (reader && roles.length) {
    for (const role of roles) {
      const database = project.parsed.config.notion.databases.find((item) => item.slug.toLowerCase() === role.toLowerCase());
      if (!database) {
        notionState = "unresolved";
        continue;
      }
      try {
        const dataSource = await reader.retrieveDataSource(database.dataSourceId);
        if (dataSource.pageId) databasePages.set(role.toLowerCase(), dataSource.pageId);
        else notionState = "unresolved";
      } catch {
        notionState = "error";
      }
    }
  }

  const links = declared.map((link) => {
    const target = notionTarget(link.target);
    const isNotion = target !== null;
    const pageId = target ? (databasePages.get(target.toLowerCase()) ?? (/^[0-9a-f]{32}$/.test(target) ? target : null)) : null;
    const href = isNotion ? (pageId ? hrefOf("notion.openPage", { pageId }) : null) : link.target;
    return { group: link.group, label: link.label, target: link.target, under: link.under, kind: isNotion ? "notion" as const : "https" as const, href };
  });

  return projectLinksDto.parse({ project: slug, notion: { state: notionState, message: statusMessage(notionState) }, links });
}
