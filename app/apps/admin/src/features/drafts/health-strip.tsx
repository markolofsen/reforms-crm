"use client";

import { useQuery } from "@tanstack/react-query";
import { sendApi } from "@/lib/api/send";

const RECIPIENTS = {
  test: { label: "test addresses only", why: "A draft can only go to the test allow-list. The owner sets draft.recipients in project.md when real clients are meant to receive mail." },
  list: { label: "a fixed list", why: "A draft can only go to the addresses listed in draft.recipients in project.md." },
} as const;

/**
 * Above the queue, ONLY when the project's setup changes what the owner can do: still a draft, no Mail account, or sends
 * limited to a list. A healthy project shows nothing here (rubric 2: the default view holds what the next decision needs);
 * "Sends to anyone" and the accounts are on the Overview card. Read-only; the owner edits project.md.
 */
export function HealthStrip({ project }: { project: string }) {
  const q = useQuery({ queryKey: ["doctor", project], queryFn: () => sendApi.doctor(project) });
  const facts = q.data?.facts ?? null;
  if (!facts) return null;
  const missing = (q.data?.checks ?? []).filter((c) => c.outcome === "fail");
  const limit = facts.recipients === "any" ? null : RECIPIENTS[facts.recipients];
  const noAccount = facts.accounts.length === 0;
  if (facts.status !== "draft" && limit === null && !noAccount) return null;
  return (
    <div className="mx-3 mt-3 flex flex-col gap-1 text-sm" data-testid="health-strip">
      {facts.status === "draft" && (
        <p className="font-medium text-warning-foreground" data-testid="health-draft" role="status">
          This project is still a draft{missing.length > 0 ? `. Missing: ${missing.map((c) => c.name).join("; ")}` : ""}.
        </p>
      )}
      {noAccount && <p className="text-warning-foreground" data-testid="health-accounts">No Mail account is set up for this project.</p>}
      {limit && (
        <p className="text-muted-foreground" data-testid="health-recipients">
          Sends to {limit.label}. {limit.why}
        </p>
      )}
    </div>
  );
}
