"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { EmptyState, LoadFailed, Loading } from "@/components/state-views";
import { useGo } from "@/hooks/use-go";
import { ProjectScopeContext, useEnsureProject, useEntry, type ProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { useSectionNav } from "@/hooks/use-section-nav";
import { metaApi } from "@/lib/api/meta";
import { usePulse } from "@/lib/pulse";
import { sectionList } from "@/routes/paths";
import { sectionTitle } from "@/routes/sections";
import { AppShell } from "./shell";
import { PaneScroll } from "./split-view";

/**
 * The frame every screen sits in. It is the seam between the route files (server, thin) and the screens (client): it
 * reads the projects and the pulse, makes the address name a project that exists, and renders the page it was given
 * only when there is one. The screens read their project from the scope, never from the address.
 */
export function ShellFrame({ children }: { children: ReactNode }) {
  const route = useRoute();
  const go = useGo();
  const pulse = usePulse();
  const projects = useQuery({ queryKey: ["projects"], queryFn: metaApi.projects });
  const list = useMemo(() => projects.data?.projects ?? [], [projects.data]);
  const entering = useEntry(list);
  const project = useEnsureProject(route, list, entering);
  const items = useSectionNav();
  const heading = route.section ? sectionTitle(route.section) : "Not found";
  const onProject = useMemo(() => (p: string) => route.section && go(sectionList(route.section), { project: p, replace: true }), [route.section, go]);
  const scope = useMemo<ProjectScope | null>(() => (project ? { project, projects: list, onProject: (p) => void onProject(p) } : null), [project, list, onProject]);
  // Overview is about every project: the switcher belongs to the single-project sections.
  const scoped = route.section === "overview" ? null : project;

  return (
    <AppShell items={items} onProject={(p) => void onProject(p)} project={scoped} projects={list} route={route} status={pulse}>
      <h2 className="sr-only">{heading}</h2>
      {projects.isPending ? (
        <PaneScroll>
          <Loading what="projects" />
        </PaneScroll>
      ) : projects.isError ? (
        <PaneScroll>
          <LoadFailed error={projects.error} onRetry={() => void projects.refetch()} retrying={projects.isFetching} what="projects" />
        </PaneScroll>
      ) : entering ? (
        <PaneScroll>
          <Loading what="the overview" />
        </PaneScroll>
      ) : !scope ? (
        <PaneScroll>
          <EmptyState title="No projects yet">Run `hub project sync` after setting one up (skill project-setup).</EmptyState>
        </PaneScroll>
      ) : (
        <ProjectScopeContext value={scope}>{children}</ProjectScopeContext>
      )}
    </AppShell>
  );
}
