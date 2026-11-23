"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { Skeleton } from "@hub/ui/skeleton";
import { SettingSwitch } from "@hub/ui/product/field";
import { QueryView } from "@/components/state-views";
import { connectionsApi } from "@/lib/api/connections";
import { sentence } from "@/lib/api/client";
import { keys } from "@/lib/cache/keys";
import { copyText } from "@/lib/external";
import { autostartSaid, mailMcpSaid, type Said } from "./autostart-labels";

type Say = { text: string; kind: "status" | "alert" } | null;

function Line({ said, onCopy, testId }: { said: Said; onCopy: (fix: string) => void; testId: string }) {
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid={testId}>
      <span className="min-w-0">{said.text}</span>
      {said.fix && (
        <>
          <code className="min-w-0 break-all rounded bg-muted px-1 py-0.5 text-xs">{said.fix}</code>
          <ActionButton aria-label={`Copy ${said.fix}`} onClick={() => onCopy(said.fix ?? "")} size="s" variant="quiet">
            <CopyIcon aria-hidden="true" />
            Copy
          </ActionButton>
        </>
      )}
    </p>
  );
}

/**
 * Settings ▸ This Mac, its first group: whether the Mac starts this instance's Hub at login (P67, decision 0033). The switch runs only `launchctl enable`
 * or `disable` on the server: Off never stops the server that answers, and the line says so. Setting the agent up is the
 * installer's (the line gives the command). Hidden off macOS.
 */
export function AutostartRow() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.autostart(), queryFn: connectionsApi.autostart });
  const [say, setSay] = useState<Say>(null);
  const set = useMutation({
    mutationFn: (enabled: boolean) => connectionsApi.setAutostart(enabled),
    onMutate: (enabled) => setSay({ text: enabled ? "Switching on..." : "Switching off...", kind: "status" }),
    onSuccess: (d) => {
      qc.setQueryData(keys.autostart(), d);
      setSay({ text: d.enabled ? "On: the Hub starts after every restart." : "Off: this server keeps running; it will not start after the next restart.", kind: "status" });
    },
    onError: (e) => setSay({ text: `Not switched: ${sentence(e)}`, kind: "alert" }),
  });
  const copy = (fix: string) => void copyText(fix).then((ok) => setSay(ok ? { text: `Copied: ${fix}`, kind: "status" } : { text: "The browser refused the clipboard: select the line and copy it.", kind: "alert" }));
  if (q.data && !q.data.supported) return null;
  const label = "Start the Hub after a restart";
  return (
    // No "Startup" heading over its one row: the row's own label says it (UX pass 2026-11-20).
    <section aria-label="Start after a restart" className="flex flex-col gap-1">
      <QueryView loading={<Skeleton aria-label="Loading whether the Hub starts after a restart" className="h-12 w-full rounded-xl" role="status" />} query={q} what="whether the Hub starts after a restart">
        {(d) => {
          const said = autostartSaid(d);
          const mail = mailMcpSaid(d);
          return (
            <div className="flex min-w-0 flex-col gap-1 py-3" data-testid="autostart">
              <div className="flex min-w-0 items-center justify-between gap-4">
                <span className="min-w-0 font-medium text-sm">{label}</span>
                <SettingSwitch checked={d.enabled} disabled={!d.installed} id="autostart-switch" label={label} onChange={(v) => set.mutate(v)} pending={set.isPending} />
              </div>
              {said && <Line onCopy={copy} said={said} testId="autostart-status" />}
              {mail && <Line onCopy={copy} said={mail} testId="autostart-mail" />}
            </div>
          );
        }}
      </QueryView>
      <div className="min-h-5 text-sm">
        <p role="status">{say?.kind === "status" ? say.text : ""}</p>
        <p className="text-destructive-foreground" role="alert">
          {say?.kind === "alert" ? say.text : ""}
        </p>
      </div>
    </section>
  );
}
