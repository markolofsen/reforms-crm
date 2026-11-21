import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { EmptyState, ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { toastManager } from "@hub/ui/toast";
import { ListDetail } from "@hub/ui/product/list-detail";
import { shortcutsOn } from "@/hooks/use-hotkeys";
import { refreshData, sentence } from "@/lib/api/client";
import { useClock } from "@/lib/clock";
import { runLocalAction } from "@/components/local-action";
import { metaApi } from "@/lib/api/meta";
import { copyText, openExternal } from "@/lib/external";
import { ConversationPane } from "@/features/mail/conversation/pane";
import { useToggleChecked } from "./mail/use-toggle-checked";
import { ListHeader, type View } from "./list-controls";
import { ListRow } from "./list-row";
import { focusRow, useReviewKeys } from "./review-keys";
import { isClosed, openResults, rowId, type ReviewDraft, type ReviewSource } from "./source";
import { useReviewActions, type Notice } from "./use-review-actions";
import { useReviewRows } from "./use-review-rows";
import { useSelection, useShareReview } from "./use-selection";

const NOTICE_MS = 8000;

type Props = {
  source: ReviewSource;
  /** The View menu: every view with its count (the host knows the counts the list does not), then the batches. */
  views: (counts: Partial<Record<string, number>>) => View[];
  onView: (value: string) => void;
  /** The search text and its setter: in the address. The host sends it to the server through its source. */
  search: [string, (value: string) => void];
  /** The open conversation: in the address (`/mail/c/7`, a client id). `onAuto` names the one the screen opened by itself, replacing the entry. */
  selection: { id: number | null; onChange: (id: number | null) => void; onAuto: (id: number) => void };
  /** `?m=`: one of their messages the open conversation scrolls to. */
  pointed?: string | null;
  /** False until the shell has measured the pane: nothing opens by itself before the width is known. */
  measured: boolean;
  /** Shown when the list is empty (the host knows its own words). */
  empty: (filtered: boolean) => ReactNode;
  /** The empty title of a filtered view ("Nothing on hold"), so the body need not say it again (UX pass 2026-11-20). */
  emptyTitle?: string;
  /** Under the header line, scrolling with the list: the project's one status line (P48 W3). */
  status?: ReactNode;
  /** A view whose rows are not people (Not by email): shown instead of the rows. */
  body?: ReactNode;
  /** A pane that is not a conversation (P97: a lead's card) and whether it is open (a phone shows it alone). */
  aside?: { node: ReactNode; open: boolean };
  /** Under the rows: the enrolments of the Follow-ups view. */
  listBottom?: ReactNode;
  mobile: boolean;
  /** The label of the Back control on a phone, and the names of the two panes. */
  noun: { list: string; back: string };
};

function Notices({ notice }: { notice: Notice | null }) {
  return (
    <>
      {notice && (
        <p className={notice.kind === "error" ? "px-4 pt-3 text-destructive-foreground text-sm" : "px-4 pt-3 text-sm text-warning-foreground"} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
    </>
  );
}

/** Only when there is more to fetch: "6 of 6 loaded" says nothing the list does not (rubric 2). */
function LoadedFooter({ loaded, total, more, fetching, onMore }: { loaded: number; total: number; more: boolean; fetching: boolean; onMore: () => void }) {
  if (!more) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t p-3">
      <p className="text-muted-foreground text-xs tabular-nums">
        {loaded} of {total} loaded
      </p>
      <ActionButton disabled={fetching} onClick={onMore} size="s" variant="secondary">
        {fetching ? "Loading" : "Load more"}
      </ActionButton>
    </div>
  );
}

/**
 * Mail (P99): the list column (views, search, people, Select) and the pane with the open conversation, its unsent message at the
 * bottom. It never sends mail by itself: Send is the unsent message's, and a batch draft opens a compose window you send from.
 */
export function ReviewWorkspace({ source, views, onView, search, selection, pointed = null, empty, emptyTitle, status, body, aside, listBottom, mobile, measured, noun }: Props) {
  const qc = useQueryClient();
  const now = useClock()();
  const actions = useReviewActions(source.project);
  const [q, setQ] = search;
  const [thread, setThread] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { query, rows, total, counts } = useReviewRows(source);
  const sel = useSelection(rows);

  // Desktop opens the first person by default (focus follows); a phone opens nothing until a row is chosen. A person the address
  // names is opened whatever the view (P99: Activity links a Done conversation while the list shows Needs you).
  const present = selection.id !== null;
  const openId = body ? null : (selection.id ?? (mobile ? null : (rows[0] ? rowId(rows[0]) : null)));
  const current = openId === null ? null : (rows.find((r) => rowId(r) === openId) ?? null);
  useShareReview(current, sel.picked);
  // P53: the address names the conversation on screen. Once the list has settled for this view and search, a wide pane whose
  // address names nobody replaces it with the first row (no history entry), so the address, the pane and the focus agree.
  const settled = measured && !body && !mobile && !query.isPending && !query.isFetching && !query.hasNextPage;
  const auto = settled && rows[0] && selection.id === null ? rowId(rows[0]) : null;
  const { onAuto } = selection;
  useEffect(() => {
    if (auto !== null) onAuto(auto);
  }, [auto, onAuto]);

  const { setNotice } = actions;
  const say = useCallback((text: string) => setNotice({ text, kind: "info" }), [setNotice]);
  useEffect(() => {
    if (!actions.notice || actions.notice.kind === "error") return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [actions.notice, setNotice]);

  const onSelect = selection.onChange;
  const go = useCallback(
    (id: number | null, focus = false) => {
      if (id == null) return;
      onSelect(id);
      document.getElementById(`person-${id}`)?.scrollIntoView({ block: "nearest" });
      if (focus) focusRow(id);
    },
    [onSelect],
  );
  // Done, Skip and Send move to the next person, so the loop is: send, send, send.
  const advance = useCallback(
    (d: ReviewDraft) => {
      const i = rows.findIndex((r) => rowId(r) === d.clientId);
      const next = rows[i + 1] ?? rows[i - 1];
      go(next ? rowId(next) : null, true);
    },
    [rows, go],
  );
  const replyAll = useCallback(
    async (d: ReviewDraft) => {
      if (!d.checked) {
        say(openResults(d).length > 0 ? "Understand the checks, then turn on I read the checks (key C)." : "Turn on I read the checks first (key C).");
        return;
      }
      // Reply all + copy (owner 2026-11-14): the text goes to the clipboard first, then the registry's compose window opens. Nothing is sent.
      const copied = await copyText(d.body); // blocked: the compose window still opens
      if (!(await runLocalAction("mail.compose", { to: d.toAddr, cc: d.ccAddr, subject: d.subject }, { post: metaApi.localOpen, open: openExternal, say }))) return;
      if (copied) say("Copied. Paste it into the Mail window and press Send there, then mark it done.");
      else say("The compose window opened; the clipboard was blocked, so copy the text from the draft.");
    },
    [say],
  );
  const undoBatch = source.undoLast;
  const undoLast = undoBatch
    ? () => {
        void undoBatch()
          .then(() => refreshData(qc))
          .catch((e: unknown) => say(sentence(e)));
      }
    : null;
  const toggleChecked = useToggleChecked(source.project, actions, say);
  useReviewKeys({
    toggleChecked,
    enabled: shortcutsOn,
    ids: rows.map(rowId),
    currentId: openId,
    current: current?.draft ?? null,
    actions,
    go,
    advance,
    replyAll: (d) => void replyAll(d),
    undoLast,
    toggleSelect: sel.toggle,
    toggleThread: () => setThread((t) => !t),
    selectAll: sel.all,
    selected: sel.picked.length,
    clearSelection: sel.clear,
    back: mobile && present ? () => onSelect(null) : null,
    focusSearch: () => searchRef.current?.focus(),
    say,
  });

  const bulk = (status: "skipped" | "hold", title: string) => {
    const targets = sel.drafts.filter((d) => !isClosed(d));
    if (targets.length === 0) return sel.clear();
    for (const d of targets) actions.setStatus(d, status, { quiet: true });
    toastManager.add({ title: `${title} ${targets.length}`, type: "success", actionProps: { children: "Undo", onClick: () => actions.undoMany(targets) } });
    sel.clear();
  };

  const filtered = source.filter !== "all";
  const header = { count: sel.picked.length, busy: actions.pending, onClear: sel.clear, onHold: () => bulk("hold", "Held"), onSkip: () => bulk("skipped", "Skipped") };
  const rowsView = query.isPending ? (
    <ListSkeleton label="Loading the people" />
  ) : query.isError && rows.length === 0 ? (
    <div className="p-3">
      <LoadFailed error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} what="the people" />
    </div>
  ) : (
    <>
      {query.isError && (
        <div className="p-3">
          <StaleNote error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState action={filtered && !q ? <ActionButton onClick={() => onView("all")} size="s" variant="secondary">Show all</ActionButton> : undefined} title={q ? "Nothing matches" : filtered ? (emptyTitle ?? "Nothing here") : "No conversation yet"}>{q ? "Nobody in this view matches the search." : empty(filtered)}</EmptyState>
      ) : (
        <ul aria-label="People" className="flex flex-col">
          {rows.map((r) => (
            <ListRow key={rowId(r)} now={now} onOpen={() => go(rowId(r))} onToggle={() => sel.toggle(rowId(r))} open={rowId(r) === openId} r={r} selected={sel.has(rowId(r))} selecting={sel.selecting} />
          ))}
        </ul>
      )}
      <LoadedFooter fetching={query.isFetchingNextPage} loaded={rows.length} more={query.hasNextPage} onMore={() => void query.fetchNextPage()} total={total} />
    </>
  );
  const list = (
    // P98 item 2: every block of the scrolling list keeps its own height; a `min-h-*` on a child would else let it shrink under its content and paint over the next one.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto *:shrink-0" data-pane="list">
      <ListHeader onSearch={setQ} onSelecting={sel.setMode} onView={onView} search={q} searchRef={searchRef} selecting={sel.selecting} selection={header} view={source.filter} views={views(counts)} />
      {status}
      {body ?? rowsView}
      {listBottom}
    </div>
  );

  const detail = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-pane="detail">
      {mobile && (
        <div className="border-b p-2">
          <ActionButton onClick={() => selection.onChange(null)} size="m" variant="quiet">
            <ArrowLeftIcon aria-hidden="true" />
            {noun.back}
          </ActionButton>
        </div>
      )}
      <Notices notice={actions.notice} />
      {aside?.open ? aside.node : openId !== null ? (
        <ConversationPane
          actions={actions}
          advance={() => current?.draft && advance(current.draft)}
          clientId={openId}
          key={openId}
          listRow={current}
          now={now}
          onThread={() => setThread((t) => !t)}
          pointed={pointed}
          project={source.project}
          say={say}
          thread={thread}
        />
      ) : (
        <EmptyState title="Nothing to open">{body ? "This view lists clients by channel, not conversations." : query.isPending ? "Loading." : "Pick a person from the list."}</EmptyState>
      )}
    </div>
  );
  return <ListDetail detail={detail} detailLabel={aside?.open ? "Lead" : "Conversation"} list={list} listLabel={noun.list} showDetail={aside?.open ? true : present} />;
}
