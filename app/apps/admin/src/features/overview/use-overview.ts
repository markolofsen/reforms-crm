import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { OverviewDto, ProjectCardDto, RefreshResponse } from "@hub/contract/overview";
import { sentence } from "@/lib/api/client";
import { overviewApi } from "@/lib/api/overview";
import { useClock } from "@/lib/clock";
import { hhmm, plural } from "@/lib/format";

export const OVERVIEW_KEY = ["overview"] as const;

export const useOverview = () => useQuery({ queryKey: OVERVIEW_KEY, queryFn: overviewApi.get });

/** The live sources a card has something to read from: mail when it lists a mailbox, Notion when `project.md` names a data source. */
export function sourcesOf(p: ProjectCardDto) {
  const sources: ("mail" | "notion")[] = [];
  if (p.mailboxes.length > 0) sources.push("mail");
  if (p.notion.clients || p.notion.leads) sources.push("notion");
  return sources;
}

const failures = (p: ProjectCardDto) =>
  [...p.mailboxes.map((m) => m.newSinceTriage.state), p.notion.clients?.count.state, p.notion.leads?.count.state].filter((s) => s === "error").length;

/** One sentence for the live region: what was read and when, or that a card shows a failure. */
function said(r: RefreshResponse, at: string): string {
  const bad = failures(r.project);
  if (bad > 0) return `${r.project.slug}: refreshed with ${plural(bad, "failure")}. The reason is on its card.`;
  if (Object.values(r.outcomes).every((o) => o === "too-soon")) return `${r.project.slug}: read less than 30 seconds ago, showing that read.`;
  return `${r.project.slug} refreshed, ${hhmm(at)}.`;
}

/**
 * Refresh is the only way a live number changes. One read at a time for the whole page (the server single-flights per
 * project; the page does not ask two at once), the result patches the cached overview, and one live region says what
 * happened: `status` for a result, `alert` for a failure.
 */
export function useRefresh() {
  const qc = useQueryClient();
  const clock = useClock();
  const [status, setStatus] = useState<{ text: string; kind: "status" | "alert" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: overviewApi.refresh,
    onSuccess: (r) => {
      qc.setQueryData<OverviewDto>(OVERVIEW_KEY, (old) => old && { ...old, verdict: r.verdict, attention: r.attention, oldestAsOf: r.oldestAsOf, projects: old.projects.map((p) => (p.slug === r.project.slug ? r.project : p)) });
      setStatus({ text: said(r, new Date(clock()).toISOString()), kind: "status" });
    },
  });
  /** True when the read went through (a failure is announced and returns false). */
  const refresh = useCallback(
    async (p: ProjectCardDto): Promise<boolean> => {
      const sources = sourcesOf(p);
      if (sources.length === 0) return true;
      setBusy(p.slug);
      setStatus({ text: `Reading ${p.slug}...`, kind: "status" });
      try {
        await mutation.mutateAsync({ project: p.slug, sources });
        return true;
      } catch (e) {
        setStatus({ text: `Could not refresh ${p.slug}: ${sentence(e)}`, kind: "alert" });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [mutation],
  );
  const refreshAll = useCallback(
    async (projects: readonly ProjectCardDto[]) => {
      let failed = 0;
      for (const p of projects) if (!p.archived && !(await refresh(p))) failed += 1;
      if (failed === 0) setStatus({ text: "Every project was read.", kind: "status" });
      else setStatus({ text: `${plural(failed, "project")} could not be read. The reason is on its card.`, kind: "alert" });
    },
    [refresh],
  );
  return { status, busy, refresh, refreshAll };
}
