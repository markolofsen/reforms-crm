"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { APP_KINDS, DESTINATION_APPS, type AppsDto } from "@hub/contract/local";
import type { InstanceDto } from "@hub/contract/instance";
import { ActionButton } from "@hub/ui/product/action-button";
import { sentence } from "@/lib/api/client";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { useInstance } from "@/lib/status";
import { SettingsGroup } from "../group";

/** One line per app: where its links open on this Mac. */
const lineOf = (installed: boolean, name: string): string => (installed ? `${name}: installed, links open in the app` : `${name}: not installed, links open in the browser`);

/**
 * Settings ▸ This Mac (P131 O2): which of Notion, Telegram and WhatsApp this Mac has, as the server's probe saw them (at start
 * and every 10 minutes; it opens nothing), and Check again after an install. Hidden where the server cannot open locally.
 */
export function AppsRow() {
  const qc = useQueryClient();
  const instance = useInstance();
  const [said, setSaid] = useState<{ text: string; kind: "status" | "alert" } | null>(null);
  const check = useMutation({
    mutationFn: metaApi.checkApps,
    onMutate: () => setSaid({ text: "Checking…", kind: "status" }),
    onSuccess: (apps: AppsDto) => {
      qc.setQueryData<InstanceDto>(keys.instance(), (old) => (old ? { ...old, apps } : old));
      setSaid({ text: "Checked.", kind: "status" });
    },
    onError: (e) => setSaid({ text: `Not checked: ${sentence(e)}`, kind: "alert" }),
  });
  const d = instance.data;
  if (!d?.localOpen) return null;
  return (
    <SettingsGroup id="apps" title="Apps for links">
      <ul className="flex flex-col gap-1 text-sm" data-testid="mac-apps">
        {APP_KINDS.map((k) => (
          <li data-app={k} data-installed={d.apps[k]} key={k}>
            {lineOf(d.apps[k], DESTINATION_APPS[k])}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton disabled={check.isPending} onClick={() => check.mutate()} size="s" variant="secondary">
          Check again
        </ActionButton>
        {said && (
          <span className="text-muted-foreground text-sm" role={said.kind === "alert" ? "alert" : "status"}>
            {said.text}
          </span>
        )}
      </div>
    </SettingsGroup>
  );
}
