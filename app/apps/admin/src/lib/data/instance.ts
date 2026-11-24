"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { ConnectionDto, ConnectionsDto } from "@hub/contract/connections";
import type { InstanceDto } from "@hub/contract/instance";
import type { AppsDto, ServerActionId } from "@hub/contract/local";
import type { SetSecretBody } from "@hub/contract/requests";
import { connectionsApi } from "@/lib/api/connections";
import { instanceApi } from "@/lib/api/instance";
import { pointerApi } from "@/lib/api/terminal";
import { keys } from "@/lib/cache/keys";

/**
 * P127 B2 (V3): the instance's reads and writes, one module (state rule 4b): the instance and its projects, the connections, the
 * Mac's autostart and apps, the core check, the pulse and the agent's pointer. Features read them here and never name a key, a
 * facade or the Query client.
 */

/** What a screen is told about one of its writes: when it starts, its answer, its failure (the screen's own live region says them). */
export type CommandEvents<R> = { onMutate?: () => void; onSuccess?: (r: R) => void; onError?: (e: unknown) => void };

/**
 * The instance's brand (name, and whether a logo is served), its local Open and its destination apps (P131 O2). Read again
 * after the server's own probe interval (10 minutes), so an app installed meanwhile is used without a reload; Check again sets it.
 */
/** The brand's logo, an <img> source (the file is the server's; the URL is the generated operation's). */
export const instanceLogoUrl = (): string => instanceApi.logoUrl();

export const useInstance = () => useQuery({ queryKey: keys.instance(), queryFn: instanceApi.instance, staleTime: 10 * 60_000 });

/** Settings ▸ This Mac's Check again: the server probes the apps now, and its answer replaces the instance's `apps`. */
export function useCheckApps(on: CommandEvents<AppsDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: instanceApi.checkApps,
    onMutate: on.onMutate,
    onSuccess: (apps: AppsDto) => {
      qc.setQueryData<InstanceDto>(keys.instance(), (old) => (old ? { ...old, apps } : old));
      on.onSuccess?.(apps);
    },
    onError: on.onError,
  });
}

/** Every project of the instance (the shell's switcher and its scope). */
export const useProjects = () => useQuery({ queryKey: keys.projects(), queryFn: instanceApi.projects });

/** Every connection and the mail accounts Apple Mail knows (Settings ▸ Connections, Mail, Agent). */
export const useConnections = () => useQuery({ queryKey: keys.connections(), queryFn: connectionsApi.list });

/**
 * The three calls on one connection: Test, Set key, Remove. Each reply is the one row, which replaces its row in the cached list.
 * A key is an argument of `setSecret` and goes nowhere else (decision 0020): not into the cache, a mutation's variables or a sentence.
 */
export function useConnectionCalls() {
  const qc = useQueryClient();
  const patch = useCallback(
    (row: ConnectionDto): ConnectionDto => {
      qc.setQueryData<ConnectionsDto>(keys.connections(), (old) => old && { ...old, connections: old.connections.map((c) => (c.id === row.id ? row : c)) });
      return row;
    },
    [qc],
  );
  return {
    test: useCallback((id: string) => connectionsApi.test(id).then(patch), [patch]),
    setSecret: useCallback((id: string, body: SetSecretBody) => connectionsApi.setSecret(id, body).then(patch), [patch]),
    remove: useCallback((id: string) => connectionsApi.remove(id).then(patch), [patch]),
  };
}

/** Whether the Mac starts this instance's Hub at login (P67). */
export const useAutostart = () => useQuery({ queryKey: keys.autostart(), queryFn: connectionsApi.autostart });

/** The autostart switch: the server's answer is the new state. */
export function useSetAutostart(on: CommandEvents<Awaited<ReturnType<typeof connectionsApi.setAutostart>>>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => connectionsApi.setAutostart(enabled),
    onMutate: on.onMutate,
    onSuccess: (d) => {
      qc.setQueryData(keys.autostart(), d);
      on.onSuccess?.(d);
    },
    onError: on.onError,
  });
}

/** The core update check (P68): never retried, the server answers from its own cache. */
export const useCore = () => useQuery({ queryKey: keys.core(), queryFn: instanceApi.core, retry: false });

/** Check now: one check at the origin; its answer is put in the cache (the check bumps no live topic). */
export function useCheckCore(on: CommandEvents<Awaited<ReturnType<typeof instanceApi.checkCore>>>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: instanceApi.checkCore,
    onMutate: on.onMutate,
    onSuccess: (d) => {
      qc.setQueryData(keys.core(), d);
      on.onSuccess?.(d);
    },
    onError: on.onError,
  });
}

/** The server's pulse (the health panel): never retried, a missed beat is the answer. */
export const usePulse = () => useQuery({ queryKey: keys.pulse(), queryFn: instanceApi.pulse, retry: false });

/** The agent's pointer (P72): the rows it rings on the owner's screen. */
export const usePointer = () => useQuery({ queryKey: keys.pointer(), queryFn: pointerApi.get });

/** P61: the one local Open (`instanceApi.localOpen`: an action and its project and key; the server resolves the path). An Open changes nothing in the Hub. */
export const postLocalOpen = (action: ServerActionId, args: unknown) => instanceApi.localOpen(action, args);

/** One Open as a mutation (P61, `components/local-action.tsx`): `run(args)` and whether it is running. It invalidates nothing. */
export function useLocalOpen(run: (args: unknown) => Promise<boolean>) {
  const m = useMutation({ mutationFn: run });
  return { run: (args: unknown) => m.mutate(args), pending: m.isPending };
}
