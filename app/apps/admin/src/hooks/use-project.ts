"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect } from "react";
import { overviewApi } from "@/lib/api/overview";
import { saveProject, useRememberedProject } from "@/lib/storage";
import { canonicalAddress, pickProject } from "@/routes/guards";
import { formatDest, paths } from "@/routes/paths";
import { routeOf } from "@/routes/typed";
import type { Resolved } from "@/routes/resolve";
import { usePath } from "./use-route";

/** The project the open screen is about, the list it came from, and how to switch. Set once by the shell frame. */
export type ProjectScope = { project: string; projects: string[]; onProject: (p: string) => void };
export const ProjectScopeContext = createContext<ProjectScope | null>(null);

/** The project of the screen. Only a screen the shell frame rendered has one, so a missing scope is a bug, named. */
export function useProjectScope(): ProjectScope {
  const scope = useContext(ProjectScopeContext);
  if (!scope) throw new Error("useProjectScope: this screen is not inside the shell frame.");
  return scope;
}

/**
 * The address always names a project that exists (so a reload or a shared link lands on the same view), and the
 * choice is remembered in the cookie `proxy.ts` reads. Returns the project, or null before the list is known or with
 * no projects. The remembered value is an external store with a `null` server snapshot, so hydration is unaffected.
 */
export function useEnsureProject(route: Resolved, projects: readonly string[], hold = false): string | null {
  const router = useRouter();
  const path = usePath();
  const search = useSearchParams().toString();
  const stored = useRememberedProject();
  const project = projects.length ? pickProject(route.project, stored, projects) : null;
  const current = `${path}${search ? `?${search}` : ""}`;
  const to = canonicalAddress(route, project, current);
  useEffect(() => {
    if (project && project !== stored) saveProject(project);
    const next = to ? routeOf(to) : null;
    if (next && !hold) router.replace(next);
  }, [project, stored, to, hold, router]);
  return project;
}

/**
 * The bare address is the entry. It opens Overview when two or more projects exist or anything needs attention
 * (P31 Q1), else Drafts. With one project the attention list decides, so the entry waits for it. Returns true while
 * the entry is undecided or on its way to Overview, so the project guard does not send it to Drafts first.
 */
export function useEntry(projects: readonly string[]): boolean {
  const router = useRouter();
  const path = usePath();
  const entry = path === "/" || path === "";
  const solo = entry && projects.length === 1;
  const overview = useQuery({ queryKey: ["overview"], queryFn: overviewApi.get, enabled: solo });
  const toOverview = entry && (projects.length >= 2 || (overview.data?.attention.length ?? 0) > 0);
  useEffect(() => {
    if (toOverview) router.replace(routeOf(formatDest(paths.overview(), null)) ?? "/");
  }, [toOverview, router]);
  return toOverview || (solo && overview.isPending);
}
