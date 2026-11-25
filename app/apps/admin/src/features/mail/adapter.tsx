import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { clientKey } from "@hub/contract/client-key";
import { dest, type Dest } from "@/routes/paths";
import type { DraftView } from "@/routes/search";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationList } from "@hub/ui/product/conversation";
import { ConversationEmptyState } from "@hub/ui/product/conversation/frame";
import { EmptyState, ListSkeleton, ListState, QueryView } from "@/components/state-views";
import { actionToast } from "@hub/ui/product/action-toast";
import { shortcutsOn } from "@/hooks/use-shortcuts";
import { sentence } from "@/lib/api/client";
import { useRefreshTopics } from "@/lib/cache/topics";
import { useClock } from "@/lib/clock";
import { runLocalAction } from "@/components/local-action";
import { postLocalOpen } from "@/lib/data/instance";
import { copyText, openLink, sameTab } from "@/lib/external";
import { ConversationPane } from "@/features/mail/conversation/pane";
import { useToggleChecked } from "@/features/mail/draft/mail-read/use-toggle-checked";
import { ListHeader, type Filters, type View } from "./list/header";
import type { BrandCount } from "./list/filter-menu";
import { ListRow } from "./list/row";
import { useMailKeys } from "./list/keys";
import type { Channel } from "@/components/conversation/adapter";
import { useOpenRow } from "@/components/conversation/list/use-list";
import { ConversationWorkspace } from "@/components/conversation/workspace";
import { usePaneNarrow } from "@/hooks/use-pane";
import { refOf } from "@hub/contract/focus";
import { isClosed, rowId, type ConversationRow, type ReviewDraft } from "@/features/mail/model";
import { useReviewRows, type ReviewSource } from "@/lib/data/conversations";
import { useFollowUps } from "@/lib/data/project";
import { chipFor } from "@/components/follow-up/words";
import { useReviewActions, type Notice } from "./list/use-review-actions";
import { useSelection, useShareReview } from "./list/use-selection";
import { selectedReady, useSendReady } from "./ready/send-ready";

const NOTICE_MS = 8000;

type Props = {
  source: ReviewSource;
  /** The header line (P134): the views with their counts (the title, and a phone's View menu) and the filter button's content. The host knows the counts the list does not. */
  header: (counts: Partial<Record<string, number>>, brands: readonly BrandCount[]) => { views: View[]; filters: Filters };
  onView: (value: string) => void;
  /** The search text and its setter: in the address. The host sends it to the server through its source. */
  search: [string, (value: string) => void];
  /** The open conversation the address names (`/mail/c/<key>`, resolved to a client id), and the view, search and batch it keeps. */
  clientId: number | null;
  /** The address names a person by email and the server has not yet said who (P103): nobody is auto-opened in the meantime. */
  pending?: boolean;
  place: { filter: DraftView; q: string; batch: number | null; brand: string | null };
  /** `?m=`: one of their messages the open conversation scrolls to. */
  pointed?: string | null;
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
  /** Under the rows: the enrolments of the Sequence steps view. */
  listBottom?: ReactNode;
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

type RowsQuery = ReturnType<typeof useReviewRows>["query"];

/** The people of the view: loading, failed, empty, or the rows with Load more. */
function PeopleRows(p: { query: RowsQuery; rows: ConversationRow[]; total: number; now: number; openId: number | null; sel: ReturnType<typeof useSelection>; searched: boolean; emptyTitle: string; empty: ReactNode; onAll: (() => void) | null; rowTo: (r: ConversationRow) => Dest; replace: boolean; followUpOf: (clientId: number) => string | null }) {
  const { query, rows, sel } = p;
  return (
    <QueryView frame={(note) => <ListState>{note}</ListState>} loading={<ListSkeleton label="Loading the people" />} query={query} what="the people">
      {() => (
    <>
      {rows.length === 0 ? (
        <EmptyState action={p.onAll ? <ActionButton onClick={p.onAll} size="s" variant="secondary">Show all</ActionButton> : undefined} compact title={p.emptyTitle}>{p.searched ? "Nobody in this view matches the search." : p.empty}</EmptyState>
      ) : (
        <ConversationList ariaLabel="People">
          {rows.map((r) => (
            <ListRow followUp={p.followUpOf(r.client.id)} key={rowId(r)} now={p.now} replace={p.replace} to={p.rowTo(r)} onToggle={() => sel.toggle(rowId(r))} open={rowId(r) === p.openId} r={r} selected={sel.has(rowId(r))} selecting={sel.selecting} />
          ))}
        </ConversationList>
      )}
      <LoadedFooter fetching={query.isFetchingNextPage} loaded={rows.length} more={query.hasNextPage} onMore={() => void query.fetchNextPage()} total={p.total} />
    </>
      )}
    </QueryView>
  );
}

/** Reply all + copy (owner 2026-11-14): the text goes to the clipboard first, then the registry's compose window opens. Nothing is sent. */
async function replyAllInMail(d: ReviewDraft, say: (text: string) => void): Promise<void> {
  if (!d.checked) {
    say("Check the draft first (key C): its checks are read in one dialog.");
    return;
  }
  const copied = await copyText(d.body); // blocked: the compose window still opens
  if (!(await runLocalAction("mail.compose", { to: d.toAddr, cc: d.ccAddr, subject: d.subject }, { post: postLocalOpen, open: (href) => void openLink(sameTab(href)), say }))) return;
  if (copied) say("Copied. Paste it into the Mail window and press Send there, then mark it done.");
  else say("The compose window opened; the clipboard was blocked, so copy the text from the draft.");
}

/**
 * Mail's channel adapter (P127 C2, V5; P99): the people of a view or a batch as rows, a person's conversation as the pane, Mail's
 * action keys (D S H U C R 1 2 3) and its multi-select, drawn by the one `ConversationWorkspace`. It never sends mail by itself:
 * Send is the unsent message's, and a batch draft opens a compose window you send from.
 */
export function MailWorkspace({ source, header: headerOf, onView, search, clientId, pending = false, place, pointed = null, empty, emptyTitle, status, body, aside, listBottom }: Props) {
  const refresh = useRefreshTopics(source.project);
  const now = useClock()();
  const narrow = usePaneNarrow();
  const actions = useReviewActions(source.project);
  const [q, setQ] = search;
  const searchRef = useRef<HTMLInputElement>(null);
  const { query, rows, total, counts, brands } = useReviewRows(source);
  const plans = useFollowUps(source.project).data?.rows;
  const sel = useSelection(rows);
  const { filter, batch, brand } = place;
  const emailOf = (id: number) => rows.find((r) => rowId(r) === id)?.client.email ?? null;
  const channelTo = (id: number | null): Dest => (id === null ? dest("mail.list", { filter, q: place.q, batch, brand }) : dest("mail.conversation", { key: clientKey({ id, email: emailOf(id) }) }, { filter, q: place.q, batch, brand }));
  const toRef = (id: number) => refOf("client", id);
  const openRow = useOpenRow({ to: channelTo, refOf: toRef }, clientId);

  // The person on screen: the one the address names, else (a wide pane, a bare list) the first row, which the workspace's auto-open
  // then writes into the address. A person the address names is opened whatever the view (P99: Activity links a Done conversation).
  // While his email key is still being asked, nobody: the first row would win the address over the person it names (P130 gate).
  const openId = body || aside?.open ? null : (clientId ?? (narrow || pending ? null : (rows[0] ? rowId(rows[0]) : null)));
  const current = openId === null ? null : (rows.find((r) => rowId(r) === openId) ?? null);
  useShareReview(current, sel.picked);

  const { setNotice } = actions;
  const say = useCallback((text: string) => setNotice({ text, kind: "info" }), [setNotice]);
  useEffect(() => {
    if (!actions.notice || actions.notice.kind === "error") return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [actions.notice, setNotice]);

  // Done, Skip and Send move to the next person, so the loop is: send, send, send.
  const advance = (d: ReviewDraft) => {
    const i = rows.findIndex((r) => rowId(r) === d.clientId);
    const next = rows[i + 1] ?? rows[i - 1];
    openRow(next ? rowId(next) : null, true);
  };
  const undoBatch = source.undoLast;
  const undoLast = undoBatch
    ? () => {
        void undoBatch()
          .then(() => refresh(["batches", "drafts"]))
          .catch((e: unknown) => say(sentence(e)));
      }
    : null;
  const toggleChecked = useToggleChecked(source.project, actions, say);
  useMailKeys({ enabled: shortcutsOn, current: current?.draft ?? null, actions, advance, replyAll: (d) => void replyAllInMail(d, say), toggleChecked, undoLast, say });

  const bulk = (status: "skipped" | "hold", title: string) => {
    const targets = sel.drafts.filter((d) => !isClosed(d));
    if (targets.length === 0) return sel.clear();
    for (const d of targets) actions.setStatus(d, status, { quiet: true });
    actionToast({ title: `${title} ${targets.length}`, type: "success", action: { label: "Undo", run: () => actions.undoMany(targets) } });
    sel.clear();
  };

  const filtered = source.filter !== "all" || brand !== null;
  const line = headerOf(counts, brands);
  // P147 3m item 5: the picked replies in today's list; Send N opens the same sheet with only them.
  const ready = useSendReady();
  const readyPicked = selectedReady(ready, sel.drafts);
  const sendPicked = ready && readyPicked.length > 0 ? { count: readyPicked.length, onSend: () => (ready.open(readyPicked), sel.clear()) } : undefined;
  const header = { count: sel.picked.length, busy: actions.pending, onClear: sel.clear, onHold: () => bulk("hold", "Held"), onSkip: () => bulk("skipped", "Skipped"), send: sendPicked };
  const channel: Channel = {
    noun: { list: "Mail", detail: "Conversation", back: "Mail" },
    ids: rows.map(rowId),
    settled: !query.isPending && !query.isFetching && !query.hasNextPage,
    refOf: toRef,
    to: channelTo,
    pane: (id, back) => (
      <ConversationPane
        actions={actions}
        advance={() => current?.draft && advance(current.draft)}
        clientId={id}
        key={id}
        listRow={current}
        notice={actions.notice}
        now={now}
        pointed={pointed}
        project={source.project}
        say={say}
        onBack={back}
      />
    ),
    idle: <ConversationEmptyState subtitle="Choose a person from the list"><EmptyState compact title="Nothing to open">{body ? "This view lists clients by channel, not conversations." : query.isPending ? "Loading." : "Pick a person from the list."}</EmptyState></ConversationEmptyState>,
    selection: { count: sel.picked.length, toggle: sel.toggle, all: sel.all, clear: sel.clear },
  };
  return (
    <ConversationWorkspace
      aside={aside ? { ...aside, label: "Lead" } : undefined}
      asked={clientId}
      pending={pending}
      body={body}
      busy={query.isFetching && !query.isPending}
      channel={channel}
      listBottom={listBottom}
      listTop={status}
      notice={<Notices notice={actions.notice} />}
      rows={
        <PeopleRows
          empty={empty(filtered)}
          followUpOf={(id) => chipFor(plans, id)}
          emptyTitle={q ? "Nothing matches" : filtered ? (emptyTitle ?? "Nothing here") : "No conversation yet"}
          now={now}
          onAll={filtered && !q ? () => onView("all") : null}
          openId={openId}
          replace={clientId !== null}
          rowTo={(r) => channelTo(rowId(r))}
          query={query}
          rows={rows}
          searched={!!q}
          sel={sel}
          total={total}
        />
      }
      searchRef={searchRef}
      toolbar={<ListHeader filters={line.filters} onSearch={setQ} onSelecting={sel.setMode} onView={onView} refreshing={query.isFetching && !query.isPending} search={q} searchRef={searchRef} selecting={sel.selecting} selection={header} view={source.filter} views={line.views} />}
    />
  );
}
