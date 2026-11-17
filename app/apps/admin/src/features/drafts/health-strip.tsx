"use client";

import { useQuery } from "@tanstack/react-query";
import { useClock } from "@/lib/clock";
import { sendApi } from "@/lib/api/send";
import { ago } from "@/lib/format";

const RECIPIENTS = {
  test: { label: "test addresses only", why: "A draft can only go to the test allow-list. The owner sets draft.recipients in project.md when real clients are meant to receive mail." },
  list: { label: "a fixed list", why: "A draft can only go to the addresses listed in draft.recipients in project.md." },
  any: { label: "anyone", why: "A draft can go to any client address. Each send is still confirmed by a person." },
} as const;

/**
 * One line above the queue: when the agent last triaged, which Mail accounts the project reads, and who a draft may go to, with
 * what each means. A project still in `draft` status says what the health checks found missing. Read-only; the owner edits project.md.
 */
export function HealthStrip({ project, lastTriageAt }: { project: string; lastTriageAt: string | null }) {
  const now = useClock()();
  const q = useQuery({ queryKey: ["doctor", project], queryFn: () => sendApi.doctor(project) });
  const facts = q.data?.facts ?? null;
  if (!facts) return null;
  const missing = (q.data?.checks ?? []).filter((c) => c.outcome === "fail");
  const r = RECIPIENTS[facts.recipients];
  return (
    <div className="mx-3 mt-3 flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm" data-testid="health-strip">
      {facts.status === "draft" && (
        <p className="font-medium text-warning-foreground" data-testid="health-draft" role="status">
          This project is still a draft{missing.length > 0 ? `. Missing: ${missing.map((c) => c.name).join("; ")}` : ""}.
        </p>
      )}
      <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
        <span data-testid="health-triage">Last triage: {lastTriageAt ? ago(lastTriageAt, now) : "never"}</span>
        <span data-testid="health-accounts">Mail accounts: {facts.accounts.length === 0 ? "none configured" : facts.accounts.join(", ")}</span>
        <span data-testid="health-recipients" title={r.why}>
          Sends to: {r.label}
        </span>
      </p>
      <p className="text-muted-foreground text-xs">{r.why}</p>
    </div>
  );
}
