# 17. Mail filters: classify all incoming mail by where it comes from

Status: built and tested (2026-11-14); first live run with the owner pending.
Owner ask: the owner's instance docs (2026-11-14, mail filters). Package: `app/packages/mail-filters` (`@hub/mail-filters`).
Skill: `skills/mail-filters/SKILL.md`. Triage reads the result: `skills/triage-mail/SKILL.md`.

## 1. Goal and shape

Gmail does the sorting, we only write the instructions. The agent proposes rules from a headers-only sample, the owner confirms,
the files land in the project folder, and the owner imports `mail-filters.xml` into Gmail himself (no OAuth, no Gmail change by
agent code). Universal: the model and the code know no project; each project has its own rules file.

| Piece | Where |
|---|---|
| Rules file | `projects/<slug>/mail-filters.md` (committed, source of truth) |
| Gmail import file | `projects/<slug>/.generated/mail-filters.xml` (generated) |
| Optional API request list | `projects/<slug>/.generated/mail-filters.api.json` (generated, never sent by code) |
| CLI (from the instance) | `./run.sh mail-filters <slug> propose\|check\|colors\|export-xml\|export-api` |

`project.md` schema v1 has no field for the file: it is found by convention (same folder). Nothing in any `project.md` changed.

## 2. Model

Categories (mail classes) come from the project's kind (`@docs/core/16`, section 3A). The generic set, which every kind contains: `client`, `partner`, `security`, `calendar`, `service`, `marketing`, `cold-outreach`, `spam`; a kind may add more (for example `billing`). Each class says whether it may skip the inbox, whether it is never sent to spam, its triage mode and its color.
Labels live under the prefix `hub/`: `hub/<category>` or below it (`hub/service/ci`).
Match: `from:<address>`, `domain:<domain>` (exact host: Gmail `@host` does not match subdomains), `list-id:<id>`, `subject:<phrase>`.
Action: `label`, or `label+skip+read` (label, skip the inbox, mark read). Nothing else exists.

### Rules file

```
## Rules
| Match | Category | Label | Action | Why | Date | By |
| domain:news.example.org | marketing | hub/marketing | label+skip+read | List-Unsubscribe on 4 of 4 messages | 2026-11-14 | agent |
## Client whitelist
| Match | Why | Date | By |
| from:jane@clientco.example | client | 2026-11-14 | owner |
## Notes
```

`By` is `agent` (proposed) or `owner`. The writer sorts by category, kind and value and drops exact duplicates: writing twice
gives the same bytes. Rows that fail parsing are reported with their line and skipped.

## 3. Safety rules (code: `safety.ts`, `rules-file.ts`, `export.ts`; tests: `test/rules.test.ts`)

1. Never delete, forward or mark spam: no such action exists; a row with `delete`, `trash`, `forward`, `spam` or `archive`
   is `forbidden_action`. The exporters never emit `shouldTrash`, `forwardTo`, `shouldSpam`, and the API list only adds the
   label and removes `INBOX` and `UNREAD`.
2. Skipping the inbox is allowed for `service` and `marketing` only, and never on a `subject:` match (a phrase can catch a client).
   Client, partner, security, calendar, cold-outreach and spam mail stays in the inbox, labelled.
3. The client whitelist always wins. Its entries become one explicit rule of their own (label `hub/client`, no skip, Gmail
   "never send to spam"). Any other category whose match overlaps a whitelist entry is an error (`whitelist_conflict`).
   Gmail cannot un-archive, so the overlap is refused up front instead of corrected later.
4. Gmail limits: values are plain (an address, a domain, a dotted list id, a subject phrase of 4 to 100 characters with no
   quote, bracket, brace, pipe, wildcard or `OR`/`AND`/`NOT`); merged `from` and `list:` queries are chunked under 1000
   characters (a conservative number of ours; Gmail documents none); at most 1000 filters per account (warning at 800).
5. Export refuses a file with any error. `check` prints the same errors and exits 1.

`neverSpam` is set on client, partner and security filters: the opposite of auto-marking spam.

## 4. Analyzer (`analyze.ts`, `test/analyze.test.ts`)

Input: `{from, subject?, listId?, hasUnsubscribe?, bulk?}` per message (invented fixtures in tests; real runs feed it from
`mail-mcp` `find_messages`, headers only, never bodies; the module itself reads nothing). Messages are grouped by sender
domain (free-mail hosts such as gmail.com by address) and voted:

| Signal | Category | Strength |
|---|---|---|
| calendar sender (calendly, calendar-notification) or invite subject | calendar | 0.9 |
| verification, password, sign-in, security-alert wording | security | 0.9 |
| List-Unsubscribe or Precedence bulk or List-Id, plus promo wording | marketing | 0.9 |
| List-Unsubscribe or bulk or List-Id | marketing | 0.85 |
| noreply or notification sender with an unsubscribe header | service | 0.6 (ask) |
| noreply, notification, billing sender or receipt wording | service | 0.8 |
| promo wording only | marketing | 0.6 (ask) |
| pitch wording, no bulk headers | cold-outreach | 0.5 (ask) |

Confidence = (share of the group's messages with the winning category) x (mean strength). At least 0.8 is proposed outright
(marketing and service with `label+skip+read`, the rest `label`); 0.5 to 0.8 is proposed as a question with `label` only; below
that, or with no signal, the group stays unclassified and is asked about. The analyzer never proposes client, partner or spam;
senders in the whitelist and the project's own addresses are counted and left out; a domain that holds a whitelisted address is
not proposed as a domain rule; already-covered senders are not proposed twice.

## 5. Exporters

- `export-xml`: Atom feed with `apps:property` entries (`from`, `subject`, `hasTheWord` for `list:`, `label`, `shouldArchive`,
  `shouldMarkAsRead`, `shouldNeverSpam`). Whitelist first, then categories in priority order. Golden file:
  `app/packages/mail-filters/test/fixtures/mailFilters.golden.xml`. The date stamp is injected, so output is reproducible.
- `export-api`: JSON `{version, project, note, requests[]}`: `labels.create` for `hub` and every label, then `filters.create`
  with `{{label:NAME}}` placeholders for the ids Gmail returns. Generated only; nothing in this repo calls the Gmail API.

## 6. Spam and the other folders

Filters take mail out of INBOX, so "all mail" means every folder. The skills (`mail-filters` step 1a, `triage-mail` step 2a)
read the folder list from `list_mailboxes`, then `INBOX`, Spam/Junk, All Mail and the `hub/*` label folders, with
`find_messages` and `dateAfter`, sender and subject only, no replies, no bodies. The report carries a separate block
"Spam: кандидаты на спасение" (a known client or whitelisted sender, an answer to our correspondence, a service the owner
subscribes to, a live request) and one counter for the rest as spam. The agent moves nothing out of Spam and never marks
"not spam": it only reports. Web Gmail is needed only when a folder is not visible in Mail; Spam is usually visible
(check with `list_mailboxes`). Typical finds: cold mailings, and now and then a service the owner subscribes to.

## 7. Triage honours the labels

`triage-mail` reads the project's `mail-filters.md` (reasoning only) and does not read or draft for senders classified
`hub/service`, `hub/marketing`, `hub/cold-outreach`, `hub/spam`; it reports them as counts. A whitelisted sender is never skipped.

## 8. Import, per Gmail account

Gmail > Settings > See all settings > Filters and Blocked Addresses > Import filters > choose `mail-filters.xml` > Open file >
Create filters (optionally "Apply new filters to existing email"). Import in every account that receives the project's mail.
Re-importing adds filters; delete the earlier `hub/` ones first. An optional Chrome applier (`claude-in-chrome`) could click
through this on the owner's explicit go; it is not part of the code and not run unasked.

## 9. Limits stated honestly

`find_messages` may not expose List-Unsubscribe or Precedence; without them marketing detection falls back to wording and
asks more. `domain:` matches the exact host, so a sender using several subdomains gets one rule per host. Real-run results
are not yet recorded here.

## 10. Label colors

The color says where the mail comes from, the same in every project. Gmail filters cannot set it: the XML import has no
color field and our API request list does not carry one. The color is set in the Gmail UI (hover the label in the left list >
three dots > Label color; or Settings > Labels > the label's color control). Setting it through the Gmail API
(`users.labels` `color.backgroundColor` / `textColor`) is possible but needs OAuth and is not done by default.

| Class | Meaning of the color | Color | Background | Text |
|---|---|---|---|---|
| `client` | warm, loudest: a person to answer | Green | `#16a766` | `#ffffff` |
| `partner` | working contact, calm | Blue | `#4a86e8` | `#ffffff` |
| `security` | urgent, act now | Dark red | `#cc3a21` | `#ffffff` |
| `calendar` | time, an invite | Dark purple | `#8e63ce` | `#ffffff` |
| `service` | machine notice, neutral | Light cyan | `#98d7e4` | `#0d3b44` |
| `marketing` | promo, muted warm | Muted yellow | `#f2c960` | `#000000` |
| `cold-outreach` | unsolicited, faint | Light gray | `#e7e7e7` | `#464646` |
| `spam` | dead weight, darkest | Dark gray | `#434343` | `#ffffff` |

Rules behind the choice: saturated colors only for what needs a human (client, security); the further a class is from the
owner's attention, the paler or greyer it is; no two classes share a hue family (blue is partner only, so service is cyan-gray);
dark backgrounds get white text, light ones black or a dark shade, aiming at readable contrast. The parent label `hub` stays
uncolored, a nested label `hub/<class>/<sub>` takes its class color. Names are ours: Gmail's menu shows swatches, the hex pair is
the identity. The pairs are from the classic Gmail palette; **confirm each hex in the picker when applying** (Custom color if a
swatch differs).

Storage: the universal table is in code (`colors.ts`, `DEFAULT_COLORS`). A project may override a class in an optional section of
its `mail-filters.md`; the writer keeps it, the parser rejects an unknown class or a color outside the palette (`bad_color_class`,
`bad_color`):

```
## Label colors
| Class | Color |
|---|---|
| partner | Dark blue |
```

`./run.sh mail-filters <slug> colors` prints "label -> color" (name, background, text, default or project) and the apply
checklist. Scope: only `hub/*` labels. Other labels in the account (Superhuman/AI, Marketing, Pitch and the like) are not
ours and are never colored.
