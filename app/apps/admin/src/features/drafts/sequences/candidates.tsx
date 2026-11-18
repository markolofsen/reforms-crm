"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CandidateDto } from "@hub/contract/sequences";
import { ActionButton } from "@hub/ui/product/action-button";
import { refreshData, sentence } from "@/lib/api/client";
import { sequencesApi } from "@/lib/api/inbox";
import { formatTime } from "@/lib/format";

type Move = { c: CandidateDto; sequence: string; notNow: boolean };
type Said = { text: string; kind: "info" | "error" };

function Moves({ name, busy, on }: { name: string; busy: boolean; on: (notNow: boolean) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton aria-label={`Enrol ${name}`} disabled={busy} onClick={() => on(false)} size="s" variant="secondary">
        Enrol
      </ActionButton>
      <ActionButton aria-label={`Not now for ${name}`} disabled={busy} onClick={() => on(true)} size="s" variant="quiet">
        Not now
      </ActionButton>
    </div>
  );
}

/**
 * The quiet clients: our message is the newest and old enough. The owner enrols one (the first step falls due on the
 * sequence's schedule) or says Not now for this silence. The server checks again that nothing is open for the client.
 */
export function Candidates({ project, candidates }: { project: string; candidates: CandidateDto[] }) {
  const qc = useQueryClient();
  const [said, setSaid] = useState<Said | null>(null);
  const move = useMutation({
    mutationFn: (m: Move) => (m.notNow ? sequencesApi.notNow(project, m.c.client.id, m.sequence) : sequencesApi.enrol(project, m.c.client.id, m.sequence)),
    onSuccess: (r, m) => {
      setSaid({ text: m.notNow ? `Not now for ${m.c.client.name}: not offered again for this silence.` : `${m.c.client.name} enrolled in ${r.enrollment.sequenceName}. Step 1 is due ${r.enrollment.nextDueAt ? formatTime(r.enrollment.nextDueAt) : "now"}.`, kind: "info" });
      void refreshData(qc);
    },
    onError: (e) => {
      setSaid({ text: sentence(e), kind: "error" });
      void refreshData(qc);
    },
  });
  return (
    <section aria-label="Suggested follow-ups" className="pt-2">
      <h4 className="px-3 pb-1 font-medium text-sm">Suggested</h4>
      {said && (
        <p className={said.kind === "error" ? "px-3 pb-2 text-destructive-foreground text-sm" : "px-3 pb-2 text-sm"} data-testid="follow-ups-said" role={said.kind === "error" ? "alert" : "status"}>
          {said.text}
        </p>
      )}
      {candidates.length === 0 ? (
        <p className="border-t px-3 py-2 text-muted-foreground text-sm">Nobody is waiting on a reply from you.</p>
      ) : (
        <ul aria-label="Suggested follow-ups">
          {candidates.map((c) => (
            <li className="flex min-w-0 flex-col gap-1 border-t px-3 py-2 text-sm" data-testid="follow-up-candidate" key={c.client.id}>
              <span className="min-w-0 truncate font-medium">{c.client.name}</span>
              <p className="truncate text-muted-foreground">{c.last.subject}</p>
              <p className="text-muted-foreground text-xs">Our last message {formatTime(c.last.at)}{c.lastInboundAt ? `; they wrote ${formatTime(c.lastInboundAt)}` : ""}</p>
              {c.sequence === null ? (
                <p className="text-muted-foreground text-xs">No sequence of this project fits this message.</p>
              ) : (
                <Moves busy={move.isPending} name={c.client.name} on={(notNow) => c.sequence !== null && move.mutate({ c, sequence: c.sequence, notNow })} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
