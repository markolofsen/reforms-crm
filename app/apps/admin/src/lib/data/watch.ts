"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { watchApi } from "@/lib/api/watch";
import { keys } from "@/lib/cache/keys";
import { useCommand } from "@/lib/cache/topics";

/** P144: the projects that watch public groups (the nav shows Watch only when one does), one project's Watch page, and Join. */
export const useWatchProjects = () => useQuery({ queryKey: keys.watchProjects(), queryFn: () => watchApi.projects(), staleTime: 60_000 });

export const useWatch = (project: string, days: number, trigger: string | null, group: string | null) =>
  useQuery({ queryKey: keys.watch(project, days, trigger, group), queryFn: () => watchApi.get(project, { days, trigger, group }), placeholderData: keepPreviousData });

/** Join one public group on the owner's click (the only write of the section): the server asks Telegram, nothing is posted. */
export const useJoinWatchGroup = (project: string) => useCommand({ project, touches: ["watch"], run: (username: string) => watchApi.join(project, username) });
