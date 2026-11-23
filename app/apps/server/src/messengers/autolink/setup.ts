import { offMode } from "@hub/config/modes";
import { join } from "node:path";
import { hubPaths } from "@hub/config/paths";
import type { Repos } from "@hub/db";
import { projectStore } from "@hub/projects";
import { startAutolink, type Autolink, type AutolinkAdapter, type UserChannel } from "./autolink";
import { startClientDirectory, type ClientDirectory } from "../../clients/directory";
import { messengersProject } from "../bot";
import { projectsRoot } from "../../projects/overview";

/** How long a read of `messengers.autolink` from project.md is reused: a change applies within this, without a restart. */
export const SETTING_TTL_MS = 30_000;

export interface ProjectAutolink {
  /** The messengers' project the directory belongs to (P96: the Mail reader asks the directory about this project only). */
  project: string | null;
  autolink: Autolink;
  directory: ClientDirectory;
  stop(): void;
}

/**
 * The server's one autolink (P84): the messengers' project (the same one the accounts store into), its Notion clients database and
 * token file from project.md, and its `messengers.autolink` read fresh. A project.md that does not parse reads as `off`: the Hub
 * links nothing on a setting it cannot read.
 */
export async function startProjectAutolink(o: {
  repos: Repos;
  env?: NodeJS.ProcessEnv;
  adapterOf: (channel: UserChannel, account: string) => AutolinkAdapter | undefined;
  accounts: () => { channel: UserChannel; account: string }[];
  root?: string;
}): Promise<ProjectAutolink> {
  const env = o.env ?? process.env;
  const off = offMode(env, "messengers") === "off";
  const pick = off ? null : await messengersProject(o.repos, env);
  const project = pick?.project ?? null;
  const root = o.root ?? projectsRoot();
  const configOf = () => {
    const p = project ? projectStore({ projects: root }).list().find((x) => x.slug === project) : undefined;
    return p && !p.parsed.issues.some((i) => i.severity === "error") ? p.parsed : null;
  };
  const first = configOf();
  const directory = startClientDirectory({
    dataSourceId: first?.databases.find((d) => d.slug === "clients")?.dataSourceId ?? null,
    tokenFile: first?.config.notion.tokenFile ?? "notion-token",
    env,
    auto: project !== null,
  });
  let cached: { at: number; on: boolean } | null = null;
  const enabled = async () => {
    if (cached && Date.now() - cached.at < SETTING_TTL_MS) return cached.on;
    const on = configOf()?.config.messengers.autolink === "on";
    cached = { at: Date.now(), on };
    return on;
  };
  const autolink = startAutolink({ repos: o.repos, project, directory, enabled, adapterOf: o.adapterOf, accounts: o.accounts, keyFile: join(hubPaths({ env }).secrets, "autolink-key") });
  return { project, autolink, directory, stop: () => directory.stop() };
}
