---
name: kb-review
description: Use when the owner wants to know what the knowledge base of one project is missing, judged from the gaps that past runs saved. Produces a ranked list of concrete fixes with draft text and a local summary. Never reads Notion and never approves an entry; writes entry files only on the owner's word, unapproved. Unlike knowledge-import, which loads files into the base, this recommends what to write.
allowed-tools: Read Write Edit Bash mcp__hub__knowledge_search mcp__hub__knowledge_get
---

# KB review (manual, one project)

> Layer: **core** (universal). Project names, people and addresses in this file are examples; one owner's facts live in `projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

The owner asks what to improve in a project's knowledge base. You read the gap reports that triage and
bulk-drafts left behind, merge them, rank them and hand over concrete edits. You write into the knowledge base only when the owner says so in this session ("внеси", "запиши в базу"): then each proposed entry becomes its file under `knowledge/files/` with `approved: false` (`skills/README.md`, "Reading and writing files"). Talk to the owner in Russian, briefly; drafts of KB text are English (the KB's language).
Rules every entry skill follows: `skills/README.md` ("Where the rules live", "Reading and writing files"). Format and types: `skills/triage-mail/references/kb-gaps.md`.

## Steps
1. **Bind** the project as `skills/triage-mail/SKILL.md` section 0.
2. **Period**: what the owner said ("за неделю", "за месяц"), default the last 14 days. Say it.
3. **Read** every `projects/<slug>/reports/kb/*.md` whose `date` is inside the period (`ls` via Bash, Read). None: say so, and that
   gap reports appear after triage or bulk runs; stop.
   Read only `reports/kb/`. Open calendar problems (`reports/problems/`, `@docs/core/19-calendar.md` section 5) are not KB gaps: if any are open, list them in a separate block at the end, one line each, and do not merge them into the ranking.
4. **Merge.** Group gaps by topic (same fact asked in other words is one group; check with `knowledge_search` when unsure).
   Per group: types seen, number of runs, number of distinct clients (sum of `seen` counts, never more than the report says),
   newest date, the highest priority seen. Do not carry anything personal: reports contain none, and you add none.
5. **Rank**: priority first (`high` > `medium` > `low`), then clients affected, then runs, then recency. A topic in three or
   more runs or from three or more clients rises one level. `conflict` and `stale` on a price, date, term or policy come before
   `missing` background. Top 10 at most; the rest as a count.
6. **Check against the KB now** (read-only): for each ranked item run `knowledge_search`, or grep and read the entry files under
   `knowledge/files/` directly (for `stale`, `conflict` or an item that may have been fixed since, read the entry itself; no Notion).
   Drop an item the KB now answers (say "уже исправлено"). Never read a database that is not listed in `project.md`.
7. **Propose**, one block per kept item, in the form of a Knowledge page, so the owner can paste it:
   `Question` (title), `Audiences`, `Category`, `Kind`, `Use` (`STATE` only for a confirmed fact, else `MARKER`), `Phrasings`
   (clients' wording, from the topics), `Valid until` if it ages, and a body draft. **The body draft states only what is already in
   a source you read** (the KB, `project.md`, the owner's words in this session). A fact nobody supplied is written as
   `[Owner: ...]` and the item is marked "ждёт ответа владельца". Never invent a figure, date or term to make the draft look complete.
   For `stale` / `conflict`: name the page, show the old text and the proposed replacement. For `repeated-question` with an
   existing answer: propose the extra phrasings and a clearer title, not a new entry. In a `knowledge.scope by-brand` project a proposed entry carries `brands:` (the brand of the gaps it closes); when two brands' gaps ask the same thing and the answer is true for both, propose `brands: [ANY]` on the existing entry instead of a copy.
8. **Write the summary** to `projects/<slug>/reports/kb/review-YYYY-MM-DD.md` (Write, inside `reports/` only; git-ignored): the period, the
   ranked table, the drafts. Reports whose date is inside the period stay as they are.
9. **Notion: nothing.** The summary lives on the local disk only. A Knowledge entry is never approved by this skill. On the owner's word it writes
   or edits the entry files (`approved: false`, front matter valid against `taxonomy.md`); otherwise he does. Either way the server refreshes the index
   when the files change (P140 K1); `hub knowledge index <slug>` does it by hand.
10. **Report** in Russian: period, runs read, groups, the top items (3 to 5 lines: type, priority, topic, one clause of proposal),
    path of the summary file, "в базе знаний ничего не изменено", and the next step: "добавь/поправь файлы в knowledge/,
    потом: переиндексируй знания проекта X".

## Checks
- No client address, name or quote anywhere in the summary.
- Every proposed fact has a source or is a `[Owner: ...]`.
- Nothing was written outside `reports/kb/`.
