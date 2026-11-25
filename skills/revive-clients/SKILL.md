---
name: revive-clients
description: Use when the owner wants a project's worn-out clients found and judged for reactivation - clients who were once active (a paid plan, a real order, real usage) but have gone quiet for a long stretch with no open follow-up plan chasing them. Produces a ranked list, each with a recommended reactivation approach (reconnect, individual offer, or leave alone) and, on the owner's word, one reconnection draft per client. Never sends, never invents a price or a fact. Unlike follow-up-sweep, which manages a client we already wrote to last and are actively chasing, this finds clients nobody is currently chasing at all.
allowed-tools: Read mcp__hub__project_show mcp__hub__client_show mcp__hub__client_map mcp__hub__message_show mcp__hub__messenger_history mcp__hub__follow_ups_due mcp__hub__knowledge_search mcp__hub__knowledge_get mcp__hub__draft_write mcp__hub__bug_report mcp__notion__notion-query-data-sources mcp__mail-mcp__find_messages mcp__mail-mcp__get_message_content
---

# Revive clients (worn-out clients: find, judge, reconnect)

> Layer: **core** (universal). Names in this file are examples; one owner's facts live in `projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

A worn-out client is not the same thing as a silent client `follow-up-sweep` already manages. `follow-up-sweep` handles a client we wrote to last, with an open plan chasing an answer. This skill finds clients **nobody is currently chasing at all** - once-real business that quietly went cold, with no plan, no nudge pending, nothing open. The two never overlap: a client with an active `follow_up_plan` state is out of scope here (it already has an owner elsewhere).

## 0. Which run this is
Bind as `skills/triage-mail/SKILL.md` section 0 first: project slug, `project_show`. Attended only, on the owner's request (a periodic run is a later step of P161).

## 1. Find candidates
Query the project's `clients` Notion source (`notion-query-data-sources`, the id `project_show` gives - never search). A candidate needs **both** of these true, not either alone:
- **Was real**: a Relationship of `Client` (not `Lead`), or a Notion profile that names a plan, an order, a paid period, or real recorded usage - evidence of money or product use at some point, not just a reply once.
- **Has gone cold with nobody chasing it**: not in `follow_ups_due` (call it once and keep the ids), no open `Follow-up status`, `Do not contact` and `Do not follow up` unticked, and their `Last two-way contact` (else the later of `Last inbound` and `Last outbound`) is well past the project's normal cadence for an active client - judge this relative to the project's own rhythm (a weekly-usage SaaS going quiet 2 months is cold; a once-a-year contract renewal is not), never a fixed universal number.

List every candidate found, oldest contact first. More than 15: work the oldest 15, name the rest left.

## 2. Judge each candidate
`client_show` (map, marks, drafts) plus the thread history (`find_messages`/`get_message_content` or `messenger_history`, whichever channel they used) to learn **why they went quiet**, not just that they did:
- They said no, stop, or asked to be removed: `do_not_contact` already, or should be - skip, never reconnect.
- They left mid-negotiation (a price pending, a decision we never heard back on): a plain reconnect fits - one short message closing the loop, no new pitch needed.
- Their last real activity used something that is now paused, stale, or moved to an individual-deal model (a project may have its own rule here): `knowledge_search` the project's own knowledge for a rule like this before assuming a flat reconnect; a dormant paid feature may need the honest "not on the continuous schedule right now" framing (never "broken", never a funding complaint) rather than a plain "haven't heard from you" nudge.
- Nothing changed, they just drifted: a plain reconnect, one new thing to say (a product update, a relevant fact from the knowledge base) - never "just checking in" with nothing new (same rule as a follow-up nudge).

## 3. Recommend, then draft on the owner's word
Report each candidate with: how long cold, what was real about them, why they likely went quiet, and one of three recommendations - **reconnect** (plain, low-effort message), **individual offer** (needs the owner's number or decision first - a placeholder `[Owner: ...]`, never invented), or **leave alone** (they refused, or reconnecting would be unwelcome). Write a draft only for `reconnect` candidates, and only once the owner confirms the batch (or a named subset) should be drafted - this skill does not write first on its own initiative any more than `bulk-drafts` does without a stated purpose.

Each draft: `draft_write` kind `reply` to the last real message in the thread (or `new` if genuinely no usable thread remains), short, one new thing from the knowledge base or their own history, never a copy of a past message, in their language (`skills/triage-mail/references/profile.md` 3c). The booking link rule applies (`skills/README.md` rule 19) if a call would help move things.

## 4. Record it
Redraw `client_map` for every client you drafted for or whose state changed (a new fact learned while judging counts, per `skills/triage-mail/references/client-map.md`). Refresh their Notion profile the same way `triage-mail` P7 does. A project with no documented rule for what "gone quiet" or "individual offer" means for it: say so under "Нужно от тебя" as P3 ("запиши в базу знаний X, что считается холодным клиентом"), so one gets written instead of the agent guessing each time. `bug_report` needs a conversation today; once P158 lands, file it there too.

## 5. Report (Russian)
Table: `# | клиент | как долго молчит | что было реально | вероятная причина | рекомендация | черновик`. Then "Нужно от тебя" (every `individual offer` needing an owner number, every placeholder). Then: "Черновики лежат в Mail и Messengers, ничего не отправлено."
