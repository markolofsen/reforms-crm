"use client";

import { useSharedFocus } from "@/lib/focus";
import { destOfRef } from "@/routes/resolve";
import { AppLink } from "@/components/app-link";

/**
 * The dock header's second quiet line (P72, decision 0038): the rows the agent points at that are not on this screen, by
 * title, each with Show, a link to where it is. Only his click navigates: the agent never does. Nothing while there is none.
 * Here in the terminal feature because it is the dock header's line. A polite status region, so the line is heard when it appears (`accessibility.md` rule 5).
 */
export function AgentPoints() {
  const { away } = useSharedFocus();
  const targets = away?.targets.flatMap((t) => {
    const to = destOfRef(t.ref, t.title);
    return to ? [{ ...t, to }] : [];
  });
  return (
    <p className="truncate px-3 pb-1.5 text-muted-foreground text-xs empty:hidden" data-testid="agent-points" role="status">
      {targets?.length ? (
        <>
          Agent points at:{" "}
          {targets.map((t, i) => (
            <span key={t.ref}>
              {i > 0 && ", "}
              {t.title ?? t.ref} ·{" "}
              <AppLink className="underline" to={t.to}>
                Show<span className="sr-only"> {t.title ?? t.ref}</span>
              </AppLink>
            </span>
          ))}
        </>
      ) : null}
    </p>
  );
}
