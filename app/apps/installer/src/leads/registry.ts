// The site registry cross-check: every host in the registry's first column has a form entry or an explicit `none` with a reason.
// A sales domain that silently has neither is how a site ships without anyone checking its form.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LeadForms } from "./config";

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Hosts in the first column of the Markdown tables of the registry (cells that are not a bare host name are skipped). */
export function registryDomains(markdown: string): string[] {
  const out = new Set<string>();
  for (const line of markdown.split("\n")) {
    const m = /^\|\s*([^|]+?)\s*\|/.exec(line);
    const cell = m?.[1]?.replace(/[`*]/g, "").trim().toLowerCase();
    if (cell && HOST.test(cell)) out.add(cell);
  }
  return [...out].sort();
}

export type RegistryCheck = { state: "unset" } | { state: "missing"; file: string } | { state: "ok"; file: string; total: number; uncovered: string[] };

export function checkRegistry(cfg: LeadForms, instanceRoot: string): RegistryCheck {
  if (!cfg.registry) return { state: "unset" };
  const file = path.resolve(instanceRoot, cfg.registry);
  if (!existsSync(file)) return { state: "missing", file };
  const domains = registryDomains(readFileSync(file, "utf8"));
  const covered = new Set([...cfg.forms.map((f) => f.domain), ...cfg.none.map((n) => n.domain)]);
  return { state: "ok", file, total: domains.length, uncovered: domains.filter((d) => !covered.has(d)) };
}
