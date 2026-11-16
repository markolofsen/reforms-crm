---
name: mail-filters
description: Use when the owner wants all incoming mail of one project sorted by origin (client, partner, service, security, calendar, marketing, cold outreach, spam), for example as Gmail filters. Produces a read-only sender sample, proposed rules, questions about the uncertain ones, then mail-filters.md and an importable mail-filters.xml in the project folder. Never changes Gmail, never sends, never deletes. Unlike triage-mail, it classifies senders and does not read or answer messages.
allowed-tools: Read Write Bash mcp__mail-mcp__list_accounts mcp__mail-mcp__list_mailboxes mcp__mail-mcp__find_messages
---

# Mail filters (manual run, one project)

> Layer: **core** (universal). Project names, people and addresses in this file are examples; one owner's facts live in `app/projects/<slug>/` (custom). Rule: `@docs/LAYERS.md`.

The owner started this session and said the instruction. You produce files; the OWNER imports them into Gmail. Talk to
the owner in Russian, briefly; files are English. Rules every entry skill follows: `skills/README.md` ("Rules").
Design: `@docs/core/17-mail-filters.md`. Package: `app/packages/mail-filters` (`@hub/mail-filters`).

Hard limits (also enforced in code, `cd app && pnpm hub mail-filters <slug> check`): filters only **label**, or **label + skip inbox +
mark read** for `service` and `marketing`. Never delete, never forward, never mark spam, never archive client, partner,
security, calendar or cold-outreach mail. The client whitelist always wins.

## 0. Bind to one project
1. Bind as `skills/triage-mail/SKILL.md` section 0 (slug, `project.md` with `mail.accounts`, `mail.addresses`, `mail.mailboxes`).
2. Read `app/projects/<slug>/mail-filters.md` if it exists (earlier rules and the client whitelist). Run
   `cd app && pnpm hub mail-filters <slug> check`; fix nothing silently, report errors.

## 1. Collect a read-only sample (headers only)
- For each account in `mail.accounts`: `list_mailboxes`, then `find_messages` with `dateAfter` = 30 days ago (or the owner's
  window) in **every** folder that can hold mail, not only `INBOX`: see step 1a. Name the account in every call.
- Keep only what `find_messages` returns about the message: sender, subject, date, and a List-Id, List-Unsubscribe or
  Precedence header if the result carries one. **Never call `get_message_content`** (no bodies). If the tool does not
  expose List-Unsubscribe, leave `hasUnsubscribe` out; the analyzer then relies on sender and subject and asks more.
- Write the sample to a scratch file as a JSON array of `{from, subject, listId, hasUnsubscribe, bulk}` (one object per
  message, no bodies). The sample holds real addresses: keep it outside the repo (the session's scratch folder) and delete it
  when the run ends.

### 1a. Spam and the other folders
Filters hide mail from INBOX, so the whole mailbox is read, Spam included.
1. The folder list comes from `list_mailboxes` for each account (and sub-mailboxes with `mailboxPath`). Read `INBOX`,
   **Spam / Junk**, **All Mail** (or Archive) and every `hub/*` label folder. Do not assume names; take them from the list.
2. Spam: `find_messages` with `dateAfter`, headers only (sender, subject), no replies, no body. Spam senders go into the sample
   like any other, so the analyzer sees them.
3. The Spam candidates for rescue are reported separately (step 4). A Spam folder not visible in Mail needs web Gmail: only then
   ask the owner whether to look there (Chrome path, step 6). Check with `list_mailboxes` whether each account's Spam folder is visible in Mail.
4. You move nothing out of Spam and never mark "not spam". You only report to the owner.

## 2. Propose
The categories are the project's kind classes (`.generated/PROJECT.json`, `mailClasses`; the generic set is the eight above); a rule with another category is refused. `cd app && pnpm hub mail-filters <slug> propose --sample <file>`. It prints a table (match, category, action, confidence, messages,
confirm, why), the unclassified groups, and how many messages belong to whitelisted clients. The analyzer never proposes
client, partner or spam: those come from the owner.

## 3. Ask the owner, one table
Show: the proposals (what Gmail would do), the counts, and the **uncertain** ones (`confirm = ask`) and the unclassified groups.
Ask the owner to confirm or reclassify the uncertain ones, to name the clients and partners (addresses or domains) and to
point out any spam he wants labelled `hub/spam`. Ask at most one batch of questions at a time; do not re-ask answered ones.

## 4. Spam: candidates for rescue (part of the report)
A separate block "Spam: кандидаты на спасение": a Spam message is a candidate when the sender is a known client or in the
whitelist, it answers our correspondence, it is a service the owner subscribed to, or it is a live request. Show sender,
subject, date, why. Then one counter: "остальные в Spam: N (как спам)". Report what you find; you do not move or unmark anything.

## 5. Write and export
1. `cd app && pnpm hub mail-filters <slug> propose --sample <file> --apply [--accept <group...>]` writes the confident proposals and
   the groups the owner confirmed into `mail-filters.md` (table `match | category | label | action | why | date | by`; `by`
   is `agent` for proposals). Add the owner's clients and partners to the file: whitelist rows under `## Client whitelist`
   (`from:<address>` or `domain:<domain>`), partner rules with `by=owner`.
2. `cd app && pnpm hub mail-filters <slug> check` must pass (exit 0).
3. `cd app && pnpm hub mail-filters <slug> export-xml` writes `app/projects/<slug>/.generated/mail-filters.xml`.
4. Optional: `export-api` writes `mail-filters.api.json`, a request list that is generated only and never sent.

## 6. Tell the owner the import steps (exact, per account)
For each Gmail account of the project (`mail.accounts`): Gmail > Settings (gear) > See all settings > **Filters and Blocked
Addresses** > **Import filters** > Choose file `app/projects/<slug>/.generated/mail-filters.xml` > Open file > **Create filters** (tick
"Apply new filters to existing email" if he wants the old mail labelled too). Labels `hub/...` are created by the import.
The file holds filters for the whole project; import it in every account that receives its mail. Re-importing is safe after
a rules change, but old filters stay: tell him to delete the earlier `hub/` filters first (Filters tab > delete) if he re-imports.

The Chrome applier is described only: with the owner's explicit go, `mcp__claude-in-chrome__*` could do the import clicks.
Do not run it unasked, and never change Gmail settings yourself.

## 6a. Label colors (after the import)
Colors are not in the XML: set them in the Gmail UI. Rules and palette: `@docs/core/17-mail-filters.md` section 10.
1. `cd app && pnpm hub mail-filters <slug> colors`: the table "label -> color" (name, background, text hex) for this project (universal
   palette plus the project's `## Label colors` overrides) and the checklist. Show it to the owner.
2. Without Chrome: give him the table and the steps (left list > hover the label > three dots > Label color).
3. In a session with Chrome (`mcp__claude-in-chrome__*`) and the owner's go: for each account, open the label menu, set the color
   from the table (Custom color with the hex pair when the swatch is not offered), confirm the hex in the picker.
4. Only `hub/*` labels that exist. Never touch other labels (an account may carry labels of other tools, for example a Superhuman or Marketing label: not ours, not
   colored), never create or rename labels to color them, never change other Gmail settings.
5. Verify with a screenshot of the label list and tell the owner which labels are colored; a mismatch is reported, not guessed.

## 7. Report
Short table: proposals applied, left for the owner, whitelist size, filters in the file, Spam rescue block, the path of
`mail-filters.xml`, the import steps, the colors table. End with "Ничего не отправлено и не изменено в Gmail."
