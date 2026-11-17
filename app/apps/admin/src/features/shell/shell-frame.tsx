"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { AppLink } from "@/components/app-link";
import { EmptyState, LoadFailed, Loading } from "@/components/state-views";
import { useGo } from "@/hooks/use-go";
import { ProjectScopeContext, useEnsureProject, useEntry, type ProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { useSectionNav } from "@/hooks/use-section-nav";
import { metaApi } from "@/lib/api/meta";
import { useOverview } from "@/features/overview/use-overview";
import { usePulse } from "@/lib/pulse";
import { paths, sectionList } from "@/routes/paths";
import { sectionTitle } from "@/routes/sections";
import { AppShell } from "./shell";
import { PaneScroll } from "./split-view";
import { standingOf } from "./status-footer";

/**
 * The frame every screen sits in. It is the seam between the route files (server, thin) and the screens (client): it
 * reads the projects and the pulse, makes the address name a project that exists, and renders the page it was given
 * only when there is one. The screens read their project from the scope, never from the address.
 */
export function ShellFrame({ children }: { children: ReactNode }) {
  const route = useRoute();
  const go = useGo();
  const pulse = usePulse();
  // The status line reads the Overview's verdict: the same query as the page, so the two cannot disagree (P31 O5).
  const overview = useOverview();
  const status = useMemo(() => ({ ...pulse, standing: standingOf(overview.data, overview.isError, pulse.stale) }), [pulse, overview.data, overview.isError]);
  const projects = useQuery({ queryKey: ["projects"], queryFn: metaApi.projects });
  const list = useMemo(() => projects.data?.projects ?? [], [projects.data]);
  const entering = useEntry(list);
  const project = useEnsureProject(route, list, entering);
  const items = useSectionNav();
  const heading = route.section ? sectionTitle(route.section) : "Not found";
  const onProject = useMemo(() => (p: string) => route.section && go(sectionList(route.section), { project: p, replace: true }), [route.section, go]);
  const scope = useMemo<ProjectScope | null>(() => (project ? { project, projects: list, onProject: (p) => void onProject(p) } : null), [project, list, onProject]);
  // Overview and Connections are about the whole instance: the switcher belongs to the single-project sections.
  const scoped = route.section === "overview" || route.section === "connections" ? null : project;

  return (
    <AppShell items={items} onProject={(p) => void onProject(p)} project={scoped} projects={list} route={route} status={status}>
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
          <EmptyState action={<AppLink to={paths.connections.page()}>Open Connections</AppLink>} title="No projects yet">Link your mail and Notion in Connections first, then ask the agent to set up your project.</EmptyState>
        </PaneScroll>
      ) : (
        <ProjectScopeContext value={scope}>{children}</ProjectScopeContext>
      )}
    </AppShell>
  );
}
