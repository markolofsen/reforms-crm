"use client";

import { checkClientMap, diffMaps, isEmptyDiff, type MapClass } from "@hub/diagram/map";
import { MAP_STATE_WORDS } from "./client-map-sources";

/**
 * P136 verdict 7b: the change from the previous version, in place of P135's toggle: nodes added (a word and the success tone),
 * removed (struck through), renamed (the old label struck) and state changes, each removed or renamed node with the agent's
 * reason under it. Every change carries its word, never a colour alone (accessibility rule 6).
 */
const stateWord = (s: MapClass | null): string => (s ? MAP_STATE_WORDS[s] : "no state");

function Why({ text }: { text: string | undefined }) {
  if (!text) return null;
  return <p className="ps-4 text-muted-foreground text-xs" data-testid="client-map-why">Why: {text}</p>;
}

export function MapChanges({ source, previous, reasons }: { source: string; previous: { source: string; at: string } | null; reasons: Record<string, string> | null }) {
  if (!previous) return <p className="text-muted-foreground text-sm" data-testid="client-map-changes">The first version: nothing to compare with.</p>;
  const now = checkClientMap(source, { sources: "optional" });
  const before = checkClientMap(previous.source, { sources: "optional" });
  if (!now.ok || !before.ok) return <p className="text-muted-foreground text-sm" data-testid="client-map-changes">The previous version could not be compared.</p>;
  const d = diffMaps(before, now);
  const why = reasons ?? {};
  return (
    <section aria-label="What changed" className="flex flex-col gap-1" data-testid="client-map-changes">
      <h3 className="font-medium text-sm">What changed</h3>
      {isEmptyDiff(d) ? (
        <p className="text-muted-foreground text-sm">The nodes are as before; only the layout or the sources changed.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {d.added.map((a) => (
            <li data-change="added" key={`a:${a.id}`}>
              <span className="font-medium text-success-foreground">Added</span> {a.label}
              {a.state && <span className="text-muted-foreground"> ({stateWord(a.state)})</span>}
            </li>
          ))}
          {d.removed.map((r) => (
            <li data-change="removed" key={`r:${r.id}`}>
              <span className="font-medium text-destructive-foreground">Removed</span> <del className="text-muted-foreground">{r.label}</del>
              <Why text={why[r.id]} />
            </li>
          ))}
          {d.renamed.map((r) => (
            <li data-change="renamed" key={`n:${r.id}`}>
              <span className="font-medium">Renamed</span> <del className="text-muted-foreground">{r.from}</del> to {r.to}
              <Why text={why[r.id]} />
            </li>
          ))}
          {d.states.map((s) => (
            <li data-change="state" key={`s:${s.id}`}>
              <span className="font-medium">{s.label}</span>: {stateWord(s.from)} to {stateWord(s.to)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
