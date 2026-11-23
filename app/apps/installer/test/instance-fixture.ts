import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CORE_ROOT, hubPaths, type HubPaths } from "@hub/config/paths";
import { CONTEXT_BLOCK_FROM } from "@hub/projects/context";
import { setSendPolicy } from "@hub/projects/send-policy";

/** The fixture projects (invented clients) shipped with the projects package tests. */
export const FIXTURE_PROJECTS = path.join(CORE_ROOT, "app", "packages", "projects", "test", "fixtures", "projects");

export interface Instance { home: string; paths: HubPaths }

/**
 * A throw-away instance folder under the OS temp dir: the one layout (`projects/`, `data/`, `state/`, `config/`), optionally holding copies of
 * fixture projects. The core is always this checkout. Nothing real is touched.
 */
export function makeInstance(projects: readonly string[] = []): Instance {
  const home = mkdtempSync(path.join(tmpdir(), "hub-inst-"));
  for (const d of ["projects", "data", "state", "config"]) mkdirSync(path.join(home, d));
  for (const p of projects) cpSync(path.join(FIXTURE_PROJECTS, p), path.join(home, "projects", p), { recursive: true });
  return { home, paths: hubPaths({ home, env: {} }) };
}

/** A send policy whose drafts may go to anyone (P49 S11: what these tests used to write into project.md). Returns `policyDir`. */
export function anyRecipients(policyDir: string, slug: string, kind = "generic"): string {
  setSendPolicy(policyDir, slug, kind, { "draft.recipients": "any" }, "test");
  return policyDir;
}

/**
 * The clock of draft-record flows that are not about context: the day before `CONTEXT_BLOCK_FROM`, when a project that sets no
 * `context.required` still records a draft without a context block (with a warning). `@hub/agent`'s `records-context.test.ts`
 * owns the block rule; these suites must not change with the calendar (they all turned red on 2026-11-23, the day after the switch).
 */
export const beforeContextBlock = (): Date => new Date(Date.parse(CONTEXT_BLOCK_FROM) - 86_400_000);
