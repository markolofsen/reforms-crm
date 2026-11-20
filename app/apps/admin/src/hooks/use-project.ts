"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo } from "react";
import { saveProject, useRememberedProject } from "@/lib/storage";
import { canonicalAddress, pickProject } from "@/routes/guards";
import type { Place } from "@/routes/paths";
import { routeOf } from "@/routes/typed";
import type { Resolved } from "@/routes/resolve";
import { usePath, useRoute } from "./use-route";

/** The project the open screen is about, the list it came from, whether there are several, and how to switch. Set once by the shell frame. */
export type ProjectScope = { project: string; projects: string[]; multi: boolean; onProject: (p: string) => void };
export const ProjectScopeContext = createContext<ProjectScope | null>(null);

/** The project of the screen. Only a screen the shell frame rendered has one, so a missing scope is a bug, named. */
export function useProjectScope(): ProjectScope {
  const scope = useContext(ProjectScopeContext);
  if (!scope) throw new Error("useProjectScope: this screen is not inside the shell frame.");
  return scope;
}

/** Where addresses are built: set by the shell frame once the projects are known. */
export const PlaceContext = createContext<Place | null>(null);

/** The place links and moves are built for: the shell's, or (before it is known) the one the address itself shows. */
export function usePlace(): Place {
  const place = useContext(PlaceContext);
  const route = useRoute();
  return place ?? { project: route.project, multi: route.inPath };
}

/**
 * The address is always canonical (so a reload or a shared link lands on the same view): one project names none, several
 * name theirs in the path, the entry and a one-project Overview open Mail (`canonicalAddress`, the one normaliser). The
 * choice of project is remembered in a cookie for a bare multi-project address. Returns the place, null before the list is
 * known or with no projects, and `pending` while the address is on its way to another screen (so that screen is not drawn first).
 */
export function useEnsureAddress(route: Resolved, projects: readonly string[]): { place: Place | null; pending: boolean } {
  const router = useRouter();
  const path = usePath();
  const search = useSearchParams().toString();
  const stored = useRememberedProject();
  const multi = projects.length >= 2;
  const project = projects.length ? pickProject(route.project, multi ? stored : null, projects) : null;
  const place = useMemo<Place | null>(() => (project ? { project, multi } : null), [project, multi]);
  const current = `${path}${search ? `?${search}` : ""}`;
  const to = place ? canonicalAddress(route, place, current) : null;
  useEffect(() => {
    if (project && multi && project !== stored) saveProject(project);
    const next = to ? routeOf(to) : null;
    if (next) router.replace(next);
  }, [project, multi, stored, to, router]);
  const pending = to !== null && (route.entry || (route.route === "overview.page" && !multi));
  return { place, pending };
}
