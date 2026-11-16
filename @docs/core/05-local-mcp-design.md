# 05. Local MCP server for the mail workflow agent

Date: 2026-11-14. Manual-first note (decision a decision or plan record kept in the owner's instance): sessions use `mail-mcp` and the Notion connector directly; the launchd and per-run `claude -p` parts below are the optional automation, OFF. Status: design plus a tested spike (the archived legacy-spike material (not part of this repo)). No real mail was read; all fixtures are invented.
(est.) = my estimate, not measured.

## 1. Goal and decision
The agent must reach the ENTIRE history with a client without flooding its context. Three layers, cheapest first:
profile (about 1-2k tokens) -> latest mail (about 1-3k) -> compact history on demand (capped, paged).

**Recommended stack:** Python 3.11 + official `mcp` SDK (stdio) + stdlib `email`/`html.parser` for conversion
+ plain files in `state/` + launchd only for the scheduler (the MCP server is spawned per `claude -p` run, not a daemon).
Reuse, do not rebuild: `mail-mcp` (read + drafts), the official Notion MCP (all Notion I/O), the archived legacy-spike material (not part of this repo) (address-wide fetch, phase 0).

## 2. Research findings
| Question | Finding | Verdict |
|---|---|---|
| Quote/signature libraries | `mail-parser-reply` 1.30 (MIT, signatures + disclaimers) supports en, de, fr, it, ja, nl, pl: **no Russian** (checked in the installed package; a Russian "написал(а):" reply was not cut). `talon` is rule+ML, HTML-capable, needs a cchardet shim on Python 3.11+. `email-reply-parser` is plain-text English only. `quotequail` 0.5.4 exists, not evaluated | Own ~300-line stdlib module (en/ru/de rules), 12 fixtures, extensible. Re-evaluate `talon` if real mail shows misses |
| HTML to Markdown | `markdownify` (BeautifulSoup) is customisable, `html2text` is old, `html-to-markdown` has HTML5 coverage; none benchmarked on email HTML | Stdlib `html.parser` converter: drops quote containers (`blockquote`, `gmail_quote`, `divRplyFwdMsg`), hidden preheaders, tracking images; zero dependencies |
| Apple Mail access | (a) AppleScript/JXA: works, slow for "sent to X"; (b) `Envelope Index` SQLite + `.emlx`, read-only, fast, needs Full Disk Access for the reading process (path `~/Library/Mail/V10/MailData/` varies by macOS version); (c) `imdinu/apple-mail-mcp` (FTS5 index over `.emlx`); (d) installed `dastrobu/mail-mcp` (draft-only, no threads, no recipient search) | Phase 0: osascript (`history.py`). Phase 1: add a read-only SQLite/emlx reader for address lookup, behind the same tool. Not tested here; whether launchd + `claude -p` inherits Full Disk Access is unverified |
| MCP framework | Official `mcp` on PyPI is **2.3.0** (2026-10-02, Python >= 3.10); v1.30 still published. v2 high-level class is `MCPServer` (v1 name: `FastMCP`). Third-party `fastmcp` (4.2.0) is a different project | Official SDK, pinned; confirm the `MCPServer` API in the phase 1 spike before coding |
| Transport | stdio is the default for a local server Claude Code launches; stdout carries the protocol, so log to stderr only. Streamable HTTP suits shared long-lived services | stdio: no port, no auth surface, dies with the run |
| Registration | `claude mcp add <name> -- <cmd> [args]`, `--scope project` writes `.mcp.json`; a stdio entry is `{command,args,env}`; `${VAR:-default}` expands. Output: warning above 10,000 tokens, default cap 25,000 (`MAX_MCP_OUTPUT_TOKENS`) | Keep each result under 8k tokens; use `--strict-mcp-config` in the runner (doc 02) |

## 3. Tools (6; schemas about 1.5k tokens (est.))
All results are JSON; `markdown` fields are inside a `<mail_data>` block (section 6). Every list has a cap and a `truncated` flag.

| Tool | Input | Output | Budget |
|---|---|---|---|
| `mail_history` | `address` (email), `depth`: `"index"` \| `"since_profile"` \| `"recent"` \| `"full"` (default `since_profile`), `limit` 1-200 (default 20), `before_id?`, `max_tokens` (default 6000, cap 15000) | `{address, total, returned, omitted:{count,oldest,newest}, last_id, truncated, markdown}` | `index`: about 25 tok/msg, 200 msgs = 5k. Others: <= `max_tokens`; newest messages kept, oldest become index lines |
| `mail_message` | `id` (Message-Id), `max_chars` (default 6000) | `{id, date, dir, from, to, subject, attachments[], flags[], markdown}` | <= 1.5k tok default |
| `profile_get` | `address` | `{exists, rev, header{}, body_md, tokens}` | <= 2k tok (hard cap, section 4) |
| `profile_update` | `address`, `expected_rev`, `patch`: `{summary?, grade?, grade_reason?, last_message_id?, facts_add[]?, facts_remove[]?, open_items?, log_entry?}` | `{ok, rev, tokens}` or `{ok:false, error:"rev_mismatch"\|"too_long"\|"not_allowed"}` | <= 300 tok |
| `mail_draft` | `reply_to_id?`, `to[]`, `subject`, `body_md` (<= 8000 chars) | `{ok, draft_id, marker, sent:false}` or refusal | <= 150 tok |
| `report_render` | `run_id`, `items[]`: `{address, action, draft_id?, profile_change?, note}` | `{markdown}` shaped for the fixed Notion run-page schema (doc 02 section 5) | <= 1k tok; no network |

Notes:
- `mail_history` is address-based, not thread-based: it matches From, To and Cc over all mailboxes of the configured accounts, deduped by Message-Id, chronological, with `id`, direction (`in`/`out` via `--me`), attachments listed (name, type, KB), never inlined.
- Message format (spike output): `### 2026-11-10 09:14Z in | From -> To | Subject` then `id: <...> | stripped: quotes,signature`, `attachments: ...`, body.
- Notion: the agent uses the official Notion MCP (search, update-page, create-pages). We add only `report_render` so the schema is code, not prose. No Notion client of our own.
- Drafts: `mail_draft` is a guarded front for the draft path (mail-mcp `create_reply` or an osascript save, chosen in phase 1). It adds what a prompt cannot guarantee: the allow-list check, the `[hub-draft thread=<thread-id>]` marker, replace-not-duplicate, `sent:false`. No tool in the server can send.

## 4. Client profile
File `state/clients/<address>.md`, one per address, UTF-8, at most 2,000 tokens (est.; `profile_update` refuses past 6,000 chars).
Header: lines between `---`, one `key: <JSON value>` per line, so stdlib `json` parses it with no YAML dependency.
```
---
address: "anna@example.com"
name: "Anna Fake"
grade: "B"
grade_reason: "pays on time, 2 open questions"
last_message_id: "<abc@example.com>"
last_message_date: "2026-11-10T09:14:00Z"
messages_seen: 37
history_depth_loaded: "since_profile"
rev: 12
updated: "2026-11-14T08:00:00Z"
converter_version: 1
---
## Summary        (<= 1,200 chars, rewritten by the agent)
## Facts          (bullets, one fact per line, deduped; facts_add / facts_remove)
## Open items     (bullets)
## Log            (append-only, newest first, last 15; older lines compacted into Summary)
```
Agent rule (goes into the SKILL): new mail from a known address -> `profile_get` + `mail_history(since_profile)`. Load `depth:"full"`
only when the profile is missing, `rev` is 0, the mail refers to something absent from the profile, or the grade is being set/changed.
`grade` is advice for the owner, never a gate for sending. Notion `Conversation summary` is fed from the profile by the report step.

## 5. Caching and idempotence
- Converted messages cached as JSONL `state/history/<address>.jsonl`, key = sha1(Message-Id + Date), field `converter_version`; a version bump rebuilds lazily.
- Same input gives byte-identical output (tested), and converting converted output changes nothing (tested).
- `mail_history` is a pure read: same args, same state, same result. `since_profile` = messages after `last_message_id`, with a 10-minute date overlap for Mail.app lag (doc 01 item 29).
- `profile_update`: compare-and-swap on `rev`, file lock, write to temp file then atomic rename. A retried call with an old `rev` fails loudly rather than duplicating a log line. `last_message_id` moves only after the draft and the report succeed (doc 02 section 4).
- `mail_draft`: one draft per marker; second call replaces the first.

## 6. Security
- **Mail is untrusted data.** Tool descriptions say so; each `markdown` is wrapped in `<mail_data>...</mail_data>` with that tag escaped inside the text. `injection_suspected` is a hint from a regex, never a defence (fixture 12 passes through as data with the flag). The real defence is capability: no send, forward, shell, web or free-path tool exists in this server, so a hijacked agent can at worst write a wrong draft or a wrong profile line.
- **Allow-list** (`config/allowlist.json`; test phase: the three addresses in doc 02). `mail_history` and `profile_*` serve only listed addresses; `mail_draft` refuses unless every recipient is listed. Checked in code, outside the prompt.
- **Draft-only by construction**; `sent:false` asserted in every result and checked again by the report step against the Sent mailbox.
- **No secrets in logs**: stderr and `state/runs/*.jsonl` carry tool name, address hash, counts, durations, token estimates, never subjects or bodies. Files mode 0600. Profiles hold client facts, so they stay on this Mac and out of git (doc 02 layout).
- A profile line written from mail text is untrusted on the next read (the same wrapper); `facts_add` items are capped at 200 chars each.
- Address input is validated against a strict regex; no tool takes a file path or a query language.

## 7. Spike: the archived legacy-spike material (not part of this repo) (measured)
`.eml` or stdin text -> Markdown. Stdlib only, Python 3.11 venv at the archived legacy-spike material (not part of this repo) (nothing installed globally; the evaluation libraries were removed after testing). Fixtures built by the archived legacy-spike material (not part of this repo) (12 invented mails: plain, HTML table, EN reply chain, Outlook with disclaimer, Russian, forwarded, newsletter, inline replies, Gmail HTML quote, attachments, German, injection). 17 tests pass: `cd tools && .venv/bin/python -m unittest test_mail_to_md`. Table: `.venv/bin/python mail_to_md.py --bench fixtures`.
Baseline = the body an agent reads today (text/plain, else the raw HTML), headers excluded on both sides. Tokens are an estimate (ASCII 4 chars/token, other scripts 2).

| fixture | raw chars | out chars | char cut | raw tok~ | out tok~ | tok cut | stripped |
|---|---:|---:|---:|---:|---:|---:|---|
| 01_plain_short | 245 | 141 | 42% | 61 | 35 | 43% | signature |
| 02_html_table | 894 | 306 | 66% | 224 | 76 | 66% | - |
| 03_reply_chain_en | 793 | 71 | 91% | 198 | 18 | 91% | quotes,signature |
| 04_outlook_disclaimer | 1375 | 110 | 92% | 344 | 28 | 92% | quotes,disclaimer,signature |
| 05_russian_reply | 583 | 137 | 77% | 234 | 61 | 74% | quotes,signature |
| 06_forwarded | 458 | 294 | 36% | 114 | 74 | 35% | forwarded,signature |
| 07_newsletter | 698 | 212 | 70% | 174 | 53 | 70% | footer |
| 08_inline_replies | 231 | 160 | 31% | 58 | 40 | 31% | quotes |
| 09_html_gmail_quote | 1078 | 60 | 94% | 270 | 15 | 94% | quotes |
| 10_attachments | 226 | 122 | 46% | 56 | 30 | 46% | signature |
| 11_german_disclaimer | 534 | 135 | 75% | 136 | 34 | 75% | quotes,disclaimer,signature |
| 12_injection | 131 | 131 | 0% | 33 | 33 | 0% | injection_suspected |
| **total** | 7246 | 1879 | 74% | 1902 | 497 | 74% | |

Behaviour: forwarded content is kept (header compressed to one line); inline replies keep up to 3 clipped quote lines for context; a message that would become empty falls back to its first 300 chars (`fallback_raw`), never silently empty; attachments are listed, not inlined.
Read it as a floor on correctness, not a forecast: fixtures are short and invented. Real chains repeat history on every reply, so the cut on long threads should be higher (est.), while real signatures and corporate HTML will lower precision until tested.

## 8. Test plan
1. Unit (done for the converter): 12 fixtures, keep/drop assertions, idempotence, never-empty, truncation, CLI stdin.
2. Add per phase: golden-file tests for `mail_history` on a fake mailbox (an `.emlx`/mbox generated by script); profile CAS races (two writers); allow-list refusals; `mail_draft` with a foreign recipient; output size assertion (every tool under its budget on a 500-message fake history).
3. Protocol: the SDK client lists tools, calls each, checks the JSON against its schema; a test that stdout contains only protocol frames.
4. Live (the owner's Mac, allow-listed fake thread of doc 02 section 6): history of `tester@example.com` vs Mail.app count, outbound included; Russian and HTML mail; `sent: 0`.
5. Real-mail calibration only with the owner's consent and on a read-only copy: sample 30 messages, count missed quotes and wrongly cut text, report percentages.

## 9. Roadmap
- **Phase 0 (now):** CLI scripts. `mail_to_md.py` done; wire it into the archived legacy-spike material (not part of this repo) output (convert each fetched body); add `profile.py get|update` with the CAS rules. Skill calls them through Bash. Exit: one full run on the fake thread, profile revised twice.
- **Phase 1:** the same functions behind a stdio server (the archived legacy-spike material (not part of this repo), official `mcp`, pinned). Register: `claude mcp add --scope project hubmail -- the archived legacy-spike material (not part of this repo) the archived legacy-spike material (not part of this repo), then list it in `config/mcp.json` for the runner. Add the SQLite/emlx reader if osascript is too slow. Exit: 24 h soak, 0 sent, every result under budget.
- **Phase 2 (hardening):** allow-list enforced in one module with tests, run log with token counts, converter version migration, `talon` comparison on a consented sample, optional launchd-managed index refresh, a kill switch file `HALT` checked by every tool.

## 10. What remains a risk
- **Recall is unmeasured on real mail.** Heuristics will cut a real sentence or keep a long signature; the converter errs to keep, with a raw-text fallback, but nothing has run on real data.
- **Mail.app reading:** osascript for outbound-by-recipient is slow on big mailboxes; SQLite needs Full Disk Access that a launchd-started process may not have; Mail.app lags the server by minutes.
- **Inline-reply loss:** interleaved quotes are clipped to 3 lines, so some context is gone; `mail_message(id)` is the escape hatch.
- **Profile drift:** an LLM rewriting a summary every run can accumulate errors or injected text; mitigated by caps, the log, `rev`, and an owner-readable file, not eliminated.
- **MCP v2 is new** (2.0 in August 2026): API details need confirming in the spike; v1.30 is the fallback.
- **Draft path** (`create_reply` pastes through the GUI) needs an unlocked session; unverified under launchd.
- **Token estimates** are character heuristics, not tokenizer counts.

## Sources
- https://pypi.org/project/mail-parser-reply/ , https://github.com/alfonsrv/mail-parser-reply
- https://docs.agentmail.to/talon-reply-extraction , https://github.com/closeio/quotequail
- https://pypi.org/project/email-reply-parser/
- https://github.com/modelcontextprotocol/python-sdk , https://pypi.org/project/mcp/ , https://py.sdk.modelcontextprotocol.io/
- https://code.claude.com/docs/en/mcp (add syntax, `.mcp.json`, output limits)
- https://gofastmcp.com/integrations/claude-code (third-party fastmcp, for contrast)
- https://imdinu.github.io/apple-mail-mcp , https://github.com/dastrobu/mail-mcp , https://github.com/patrickfreyer/apple-mail-mcp
- https://glukhov.org/documentation-tools/markdown/convert-html-to-markdown-in-python/

## Note 2026-11-14
Decision 0003: the client key is not only an email address; `client_identifiers` links mail addresses and messenger chats to one client, `mail_history` becomes `client_history` over both.
