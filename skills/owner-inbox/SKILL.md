---
name: owner-inbox
description: Use when the owner asks what waits for him in one project or where to start. Gathers open questions, knowledge gaps, calendar problems, run reports and unfilled placeholders in unsent drafts into ONE ranked list, each item with the sentence to say next. Read only. Unlike status, which checks that the setup works, this lists decisions and tasks for the owner.
allowed-tools: Read Bash mcp__mail-mcp__list_drafts mcp__hub__focus mcp__hub__mail_list mcp__hub__draft_show
---

# Owner inbox (what needs you, read only)

> Layer: **core** (universal). Names in this file are examples; one owner's facts live in `projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

Rules: `skills/README.md` ("Rules"). Talk to the owner in Russian, briefly. You write nothing and send nothing.

"Что тут нужно?" asked while the admin is open (P51): call `focus` first (the `hub` MCP server; the session rules) and start the list with what the focused draft or the selected drafts need; then the rest of the project.

1. **Bind** as `skills/triage-mail/SKILL.md` section 0 (one project per session). Read `projects/<slug>/project.md` and its mail account names only.
2. **Collect**, inside `projects/<slug>/` only (Bash `ls`, Read):
   - unset or draft settings: no `tone`, no `draft.recipients`, `status: draft` -> P2;
   - open rows of `## Answers` / `project_questions` -> P2;
   - `reports/kb/*.md` records with priority `high` not yet fixed -> P3 (P2 when the same gap repeats across runs);
   - `reports/problems/*.md` open calendar problems -> P2;
   - `reports/runs/*` (when present): the "Нужно от тебя" lines of the newest runs -> keep their P level;
   - follow-ups (P47): `hub sequences due <slug>` and `hub sequences candidates <slug>` (read only); any due -> P2 "подготовь follow-up проекта <slug>"; candidates -> P3 "подготовь follow-up молчащим клиентам проекта <slug>" (a session enrols only on his words; this skill never enrols);
   - The hub's open drafts: `mail_list` (hub, view `needs_you`: the rows with an open draft), then `draft_show` per draft; its `mail` names the Mail version the hub recorded (account and Message-ID). Read that draft's text in `list_drafts` for the project's account by that Message-ID (nothing of the hub's is in the text, decision 0031): one that still holds `[Owner:` or `[Check:` -> P1. Name the client by row number or subject, never quote the draft.
3. **Print ONE list**, ranked P1, P2, P3, each line `[P#] что | где | что сказать`. The last column is a phrase the owner can say verbatim (`разбери почту проекта X`, `что улучшить в базе знаний X`, `настрой проект X`, `разбери календарь проекта X`, `подготовь follow-up проекта X`).
4. Nothing found: "по проекту <slug> от тебя ничего не нужно". More than 10 lines: show the top 10 and the count of the rest.
