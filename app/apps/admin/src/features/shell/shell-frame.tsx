"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { DEFAULT_INSTANCE_NAME } from "@hub/contract/instance";
import { Page } from "@hub/ui/product/page";
import { AppLink } from "@/components/app-link";
import { EmptyState, LoadFailed, Loading } from "@/components/state-views";
import { AgentFeedContext, useAgentFeed } from "@/features/agent-feed/use-agent-feed";
import { useTurnSound } from "@/features/agent-feed/use-turn-sound";
import { useFocusPublisher } from "@/features/focus/use-focus-publisher";
import { TerminalDock, TerminalProvider } from "@/features/terminal/terminal";
import { terminalProjectOf } from "@/features/terminal/use-auto-start";
import { useGo } from "@/hooks/use-go";
import { PlaceContext, ProjectScopeContext, useEnsureAddress, type ProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { useSectionNav } from "@/hooks/use-section-nav";
import { metaApi } from "@/lib/api/meta";
import { useLive } from "@/lib/cache/live";
import { usePulse } from "@/lib/cache/pulse";
import { dotOf, useAgentToolsNeedYou, useInstance, useProjectRow } from "@/lib/status";
import { paths, sectionList } from "@/routes/paths";
import { PROJECTLESS, type RouteId } from "@/routes/table";
import { NEXT_ROUTE, sectionTitle } from "@/routes/sections";

import { AppShell, type ShellNavItem } from "./shell";
import { keys } from "@/lib/cache/keys";

/**
 * The nav with a dot on the page that fixes the project's worst fact (`statusDto.next`: Overview, Knowledge or a Settings pane,
 * P70), and on Settings ▸ Agent while an Agent tools row is red. A child's dot also lights its parent (the rail and the phone draw
 * parents only); the tab bar lights More from the parents inside it.
 */
function useNavWithDots(project: string | null): ShellNavItem[] {
  const items = useSectionNav();
  const { row } = useProjectRow(project ?? "");
  const next = dotOf(row?.status);
  const tools = useAgentToolsNeedYou(project);
  return useMemo(() => {
    const lit = new Set<RouteId>([...(next ? [NEXT_ROUTE[next]] : []), ...(tools ? (["settings.agent"] as const) : [])]);
    return items.map((i) => {
      const children = i.children.map((c) => ({ ...c, dot: lit.has(c.route) }));
      return { ...i, children, dot: lit.has(i.route) || children.some((c) => c.dot) };
    });
  }, [items, next, tools]);
}

/**
 * The frame every screen sits in. It is the seam between the route files (server, thin) and the screens (client): it
 * opens the live stream (P50), reads the projects, the brand and the pulse, makes the address canonical (`useEnsureAddress`), and renders the page it
 * was given only when there is a project. The screens read their project from the scope, never from the address.
 */
export function ShellFrame({ children }: { children: ReactNode }) {
  const route = useRoute();
  const go = useGo();
  useLive();
  usePulse();
  const instance = useInstance();
  const projects = useQuery({ queryKey: keys.projects(), queryFn: metaApi.projects });
  const list = useMemo(() => projects.data?.projects ?? [], [projects.data]);
  const { place, pending } = useEnsureAddress(route, list);
  const project = place?.project ?? null;
  useFocusPublisher(project);
  const multi = place?.multi ?? false;
  const heading = route.section ? sectionTitle(route.section) : "Not found";
  const onProject = useMemo(() => (p: string) => route.section && go(sectionList(route.section), { project: p, replace: true }), [route.section, go]);
  const scope = useMemo<ProjectScope | null>(() => (project ? { project, projects: list, multi, onProject: (p) => void onProject(p) } : null), [project, list, multi, onProject]);
  const brand = { name: instance.data?.name ?? DEFAULT_INSTANCE_NAME, logoSrc: instance.data?.hasLogo ? "/api/instance/logo" : null };
  // The projectless pages (Overview, Help, Settings ▸ Connections and This Mac) are about the whole instance: the switcher belongs to the scoped ones.
  const scoped = route.route !== "notFound" && PROJECTLESS.has(route.route) ? null : project;
  return (
    <PlaceContext value={place}>
      <Shell brand={brand} dotsProject={project} onProject={(p) => void onProject(p)} project={scoped} projects={list} route={route} terminalProject={terminalProjectOf({ loaded: projects.isSuccess, pending, project, multi, scoped })}>
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
            <EmptyState action={<AppLink to={paths.settings.connections()}>Open Connections</AppLink>} title="No projects yet">Ask the agent to set up your project: say “настрой проект” in a session.</EmptyState>
          </Page>
        ) : (
          <ProjectScopeContext value={scope}>{children}</ProjectScopeContext>
        )}
      </Shell>
    </PlaceContext>
  );
}

/**
 * The shell with its nav and the terminal (P49), which follows the project of the address. With two or more projects the
 * projectless pages have none (Shell only); with one, the whole admin is that project, so the terminal has it there too (P57 2l).
 * The agent feed (P59) follows the terminal's project: its rows in the sidebar's footer, its wait on the strip's dot, its tones.
 */
function Shell({ project, dotsProject, terminalProject, ...props }: Omit<Parameters<typeof AppShell>[0], "items" | "dock"> & { project: string | null; dotsProject: string | null; terminalProject: string | null | undefined }) {
  // The dots follow the address's project on every page, a projectless one included (its switcher is hidden, not its dots).
  const items = useNavWithDots(dotsProject);
  const feed = useAgentFeed(terminalProject ?? null);
  useTurnSound(feed);
  return (
    <TerminalProvider project={terminalProject}>
      <AgentFeedContext value={feed}>
        <AppShell dock={<TerminalDock attention={feed.attention} onSeen={feed.seen} />} items={items} project={project} {...props} />
      </AgentFeedContext>
    </TerminalProvider>
  );
}
