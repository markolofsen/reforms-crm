import { ArrowLeftIcon } from "lucide-react";
import type { ActivitySessionDto } from "@hub/contract/activity";
import { Page } from "@hub/ui/product/page";
import { AppLink } from "@/components/app-link";
import { EmptyState } from "@/components/state-views";
import { paths } from "@/routes/paths";
import type { RunFilter } from "@/routes/search";
import { rowSentence, sessionFacts, sessionTitle } from "./labels";

/** Back to the table: a phone shows the session as its own screen (from the list-detail's split width the table stays beside it). */
function Back({ filter }: { filter: RunFilter }) {
  return (
    <AppLink className="@4xl:hidden" to={paths.log.list({ filter })}>
      <ArrowLeftIcon aria-hidden="true" className="me-1 size-4" />
      Back to Activity
    </AppLink>
  );
}

/**
 * One session read as sentences: when, which skill, what happened to each client and why, with a link into a draft the
 * session made. The model, tokens, cost and duration show only when the hub measured them.
 */
export function SessionDetail({ session: s, filter }: { session: ActivitySessionDto; filter: RunFilter }) {
  const facts = sessionFacts(s);
  return (
    <Page>
      <Back filter={filter} />
      <div className="flex flex-col gap-1">
        <h3 className="font-heading font-medium text-base">{sessionTitle(s)}</h3>
        {facts.length > 0 && <p className="text-muted-foreground text-xs tabular-nums">{facts.join(" · ")}</p>}
      </div>
      {s.rows.length === 0 ? (
        <p className="measure text-muted-foreground text-sm">The agent recorded nothing about a client in this session.</p>
      ) : (
        <ul aria-label="What happened" className="measure flex flex-col gap-2 text-sm">
          {s.rows.map((r) => (
            <li className="flex flex-col gap-0.5" key={r.id}>
              <p className="break-words">{rowSentence(r)}</p>
              {r.draftId !== null && <AppLink to={paths.drafts.item(r.draftId)}>{`Open the draft${r.client ? ` for ${r.client.name}` : ""}`}</AppLink>}
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

/** The detail when `?run=` names a session this view does not hold (another filter, or gone). */
export function SessionMissing({ filter }: { filter: RunFilter }) {
  return (
    <Page>
      <Back filter={filter} />
      <EmptyState action={<AppLink to={paths.log.list()}>Show every session</AppLink>} title="This session is not in this view" />
    </Page>
  );
}

/** Beside the table (the list-detail's split), before a session is opened. */
export function SessionHint() {
  return (
    <Page>
      <p className="measure text-muted-foreground text-sm">Open a session heading to read it as sentences.</p>
    </Page>
  );
}
