"use client";

import type { AgentCapability } from "@hub/contract/agent-tools";
import { phrase } from "@hub/contract/help";
import { useAgentTools } from "@/lib/status";

const LABEL: Record<AgentCapability["kind"], string> = { calendar: "Calendar", drive: "Drive" };
const SCOPE: Record<AgentCapability["kind"], string> = { calendar: "read, holds with no guests", drive: "search, read and link only" };

/**
 * Settings ▸ Agent ▸ Claude Code, Connectors (P62): the Google services this project's Claude Code sessions (only they: Codex
 * cannot sign in) reach beyond mail and Notion, one
 * line each, as the server last checked them (the same read as Checks, so it costs no call). Attached in project.md by a phrase
 * in a session, never here (`admin-principles.md` rule 1); what is wrong with a connector is a Checks row with its fix.
 */
export function Connectors({ slug }: { slug: string }) {
  const q = useAgentTools(slug);
  const caps = q.data?.capabilities;
  if (!caps) return null;
  return (
    <section aria-labelledby="agent-connectors-title" className="flex flex-col pt-2">
      <h3 className="py-2 font-medium text-sm" id="agent-connectors-title">
        Connectors
      </h3>
      {caps.length === 0 ? (
        <p className="measure py-2 text-muted-foreground text-sm" data-testid="agent-connectors-none">
          None. To use a Google Calendar or Drive here, say “{phrase("project-setup", slug)}” in a session.
        </p>
      ) : (
        <ul className="flex flex-col divide-y" data-testid="agent-connectors">
          {caps.map((c) => (
            <li className="flex min-h-(--control-m) min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm" key={c.name}>
              <span className="w-28 shrink-0 font-medium sm:w-36">{LABEL[c.kind]}</span>
              <span className="min-w-0 flex-1 break-words">
                {c.name} · {c.account ?? "account not confirmed yet"} <span className="text-muted-foreground">· {SCOPE[c.kind]}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
