"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { FeedRowDto } from "@hub/contract/agent-feed";
import { ActionButton } from "@hub/ui/product/action-button";
import { cn } from "@hub/ui/cn";
import { AppLink } from "@/components/app-link";
import { useClock } from "@/lib/clock";
import { hhmm } from "@/lib/format";
import { paths } from "@/routes/paths";
import { recentRows } from "./turns";
import { useFeed } from "./use-agent-feed";

const STATE_SUFFIX: Record<FeedRowDto["state"], string> = { running: "", done: "", failed: " · failed", refused: " · refused" };
const CLI_MARK: Record<FeedRowDto["cli"], string> = { claude: "C", codex: "X" };
const CLI_NAME: Record<FeedRowDto["cli"], string> = { claude: "Claude Code", codex: "Codex" };
/** Fewer rows when the sidebar is short, never a scroll: rows 4 and 5 go below 44rem of height, row 3 below 38rem. Static strings (`stylesheets-and-class-lists.md`). */
const SHORT: readonly string[] = ["", "", "[@media(max-height:38rem)]:hidden", "[@media(max-height:44rem)]:hidden", "[@media(max-height:44rem)]:hidden"];

/** Arrow keys move between the block's links (one tab stop for the list); Home and End go to the ends. */
function moveFocus(e: KeyboardEvent<HTMLAnchorElement>, list: HTMLOListElement | null, setActive: (i: number) => void): void {
  const links = [...(list?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
  const at = links.indexOf(e.currentTarget);
  const next = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? links.length - 1 : null;
  if (next === null || at < 0) return;
  e.preventDefault();
  const i = Math.max(0, Math.min(links.length - 1, next));
  setActive(i);
  links[i]?.focus();
}

/**
 * The last five things the agent did in this project (P59), in the sidebar's footer: the time, the label the server
 * computed, a CLI mark when both CLIs ran, and a link to the draft card when the row names one. Not a log view: no
 * history, no filter (that is `hub log`), and hidden when the newest row is over an hour old. New rows reach a polite
 * status region; focus and scroll never move.
 */
export function FeedBlock() {
  const feed = useFeed();
  const now = useClock()();
  const list = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);
  if (!feed?.project) return null;
  if (feed.failed) {
    return (
      <p className="flex items-center gap-2 px-2 text-muted-foreground text-xs group-data-[collapsible=icon]:hidden">
        Agent activity did not load.
        <ActionButton disabled={feed.retrying} onClick={feed.retry} size="s" variant="quiet">Retry</ActionButton>
      </p>
    );
  }
  const rows = recentRows(feed.data, now);
  if (!rows.length) return null;
  const both = new Set(rows.map((r) => r.cli)).size > 1;
  // Each link row's place among the links, for the one tab stop.
  const linkAt = rows.map((_, i) => rows.slice(0, i + 1).filter((x) => x.draft).length - 1);
  return (
    <section aria-label="Agent activity" className="px-2 group-data-[collapsible=icon]:hidden" data-testid="agent-feed">
      <ol className="flex flex-col" ref={list}>
        {rows.map((r, i) => {
          const text = `${r.label}${STATE_SUFFIX[r.state]}`;
          const mine = linkAt[i] ?? -1;
          return (
            <li className={cn("flex min-h-(--control-s) min-w-0 items-center gap-2 text-xs", SHORT[i])} key={r.id}>
              <time className="shrink-0 text-muted-foreground tabular-nums" dateTime={r.at}>{hhmm(r.at)}</time>
              {r.draft ? (
                <AppLink bare className="min-w-0 truncate rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" onFocus={() => setActive(mine)} onKeyDown={(e) => moveFocus(e, list.current, setActive)} tabIndex={mine === active ? 0 : -1} to={paths.drafts.item(r.draft)}>
                  {text}
                </AppLink>
              ) : (
                <span className="min-w-0 truncate">{text}</span>
              )}
              {both && (
                <span className="ms-auto shrink-0 text-muted-foreground" title={CLI_NAME[r.cli]}>
                  <span aria-hidden="true">{CLI_MARK[r.cli]}</span>
                  <span className="sr-only">{CLI_NAME[r.cli]}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only" role="status">{rows[0] ? `Agent: ${rows[0].label}` : ""}</p>
    </section>
  );
}
