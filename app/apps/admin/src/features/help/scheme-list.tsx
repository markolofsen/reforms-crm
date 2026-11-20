import { BLOCKS, blockStates, blockWhat, CUTS, LANE_LINKS, LANES, type Block, type CutId } from "@hub/contract/scheme-model";
import { SCHEME_WORDS, type SchemeNode } from "@hub/contract/scheme";
import { cn } from "@hub/ui/cn";

/**
 * A drawing as text (P81): what Help shows when no form of the drawing fits the card with labels of 12 px or more (a phone), from
 * the same model, so it says the same. A block's standing is a dot and its word, never a colour alone.
 */

const DOT = { ok: "bg-success", warn: "bg-warning", fail: "bg-destructive" } as const;

function BlockLine({ block, nodes }: { block: Block; nodes: readonly SchemeNode[] }) {
  const s = blockStates(nodes)[block.id];
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{block.label}</span>
        <span className="text-muted-foreground text-xs">{blockWhat(block, nodes)}</span>
      </span>
      {s && (
        <span className="ms-auto flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
          <span aria-hidden="true" className={cn("size-2 rounded-full", DOT[s.state])} />
          {SCHEME_WORDS[s.state]}
        </span>
      )}
    </span>
  );
}

/** The general view: each lane, its blocks, and what leaves it for which lane. */
export function LanesList({ nodes }: { nodes: readonly SchemeNode[] }) {
  return (
    <ol className="flex flex-col gap-3" data-testid="scheme-list">
      {LANES.map((lane) => (
        <li className="flex flex-col gap-1" key={lane.id}>
          <span className="font-medium text-muted-foreground text-xs">{lane.label}</span>
          <ul className="flex flex-col divide-y rounded-md border px-3">
            {BLOCKS.filter((b) => b.lane === lane.id).map((b) => (
              <li className="py-1.5" key={b.id}>
                <BlockLine block={b} nodes={nodes} />
              </li>
            ))}
          </ul>
          {LANE_LINKS.filter((k) => k.from === lane.id).map((k) => (
            <p className="text-muted-foreground text-xs" key={k.to}>
              → {LANES.find((l) => l.id === k.to)?.label}: {k.label}
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}

/** A cut: its links in order, each "from → to" with its words. */
export function CutList({ cut }: { cut: CutId }) {
  const block = (id: Block["id"]) => BLOCKS.find((b) => b.id === id);
  return (
    <ol className="flex flex-col divide-y rounded-md border px-3" data-testid="scheme-list">
      {(CUTS.find((c) => c.id === cut)?.links ?? []).map((l) => (
        <li className="flex min-w-0 flex-col gap-0.5 py-1.5" key={`${l.from}-${l.to}`}>
          <span>
            <span className="font-medium">{block(l.from)?.label}</span> → <span className="font-medium">{block(l.to)?.label}</span>
          </span>
          <span className="text-muted-foreground text-xs">{l.label}</span>
        </li>
      ))}
    </ol>
  );
}
