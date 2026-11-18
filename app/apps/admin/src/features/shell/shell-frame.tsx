"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { DEFAULT_INSTANCE_NAME } from "@hub/contract/instance";
import { Page } from "@hub/ui/product/page";
import { AppLink } from "@/components/app-link";
import { EmptyState, LoadFailed, Loading } from "@/components/state-views";
import { useGo } from "@/hooks/use-go";
import { PlaceContext, ProjectScopeContext, useEnsureAddress, type ProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { useSectionNav } from "@/hooks/use-section-nav";
import { metaApi } from "@/lib/api/meta";
import { usePulse } from "@/lib/pulse";
import { dotOf, useInstance, useProjectRow } from "@/lib/status";
import { paths, sectionList } from "@/routes/paths";
import { sectionTitle } from "@/routes/sections";
import { AppShell, type ShellNavItem } from "./shell";

/** The nav with a dot on the section that fixes the project's worst fact (Project or Connections). */
function useNavWithDots(project: string | null): ShellNavItem[] {
  const items = useSectionNav();
  const { row } = useProjectRow(project ?? "");
  const dot = dotOf(row?.status);
  return useMemo(() => items.map((i) => ({ ...i, dot: dot !== null && i.id === dot })), [items, dot]);
}

/**
 * The frame every screen sits in. It is the seam between the route files (server, thin) and the screens (client): it
 * reads the projects, the brand and the pulse, makes the address canonical (`useEnsureAddress`), and renders the page it
 * was given only when there is a project. The screens read their project from the scope, never from the address.
 */
export function ShellFrame({ children }: { children: ReactNode }) {
  const route = useRoute();
  const go = useGo();
  usePulse();
  const instance = useInstance();
  const projects = useQuery({ queryKey: ["projects"], queryFn: metaApi.projects });
  const list = useMemo(() => projects.data?.projects ?? [], [projects.data]);
  const { place, pending } = useEnsureAddress(route, list);
  const project = place?.project ?? null;
  const multi = place?.multi ?? false;
  const heading = route.section ? sectionTitle(route.section) : "Not found";
  const onProject = useMemo(() => (p: string) => route.section && go(sectionList(route.section), { project: p, replace: true }), [route.section, go]);
  const scope = useMemo<ProjectScope | null>(() => (project ? { project, projects: list, multi, onProject: (p) => void onProject(p) } : null), [project, list, multi, onProject]);
  const brand = { name: instance.data?.name ?? DEFAULT_INSTANCE_NAME, logoSrc: instance.data?.hasLogo ? "/api/instance/logo" : null };
  // Overview and Connections are about the whole instance: the switcher belongs to the single-project sections.
  const scoped = route.section === "overview" || route.section === "connections" ? null : project;
  return (
    <PlaceContext value={place}>
      <Shell brand={brand} onProject={(p) => void onProject(p)} project={scoped} projects={list} route={route}>
        <h2 className="sr-only">{heading}</h2>
        {projects.isPending || pending ? (
          <Page>
            <Loading what="projects" />
          </Page>
        ) : projects.isError ? (
          <Page>
            <LoadFailed error={projects.error} onRetry={() => void projects.refetch()} retrying={projects.isFetching} what="projects" />
          </Page>
        ) : !scope ? (
          <Page>
            <EmptyState action={<AppLink to={paths.connections.page()}>Open Connections</AppLink>} title="No projects yet">Ask the agent to set up your project: say “настрой проект” in a session.</EmptyState>
          </Page>
        ) : (
          <ProjectScopeContext value={scope}>{children}</ProjectScopeContext>
        )}
      </Shell>
    </PlaceContext>
  );
}

function Shell({ project, ...props }: Omit<Parameters<typeof AppShell>[0], "items"> & { project: string | null }) {
  const items = useNavWithDots(project);
  return <AppShell items={items} project={project} {...props} />;
}
