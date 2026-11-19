# Lead forms: the check that a lead still arrives

Layer: core. The list of forms is the instance's own (`config/lead-forms.json`); the check, the canary contract, the rule and the skill are core.

A site's tests run in process. They cannot see a DNS record, a CSP header, a proxy, a CDN rule or a Turnstile key that stops every form in production, and nobody is told. The `Leads` doctor group looks at each public form from outside, the way a visitor's browser does.

## Run it

| Command | Does |
|---|---|
| `hub doctor --only Leads` | GET only: the default. Also part of plain `hub doctor` and `hub doctor --fast` (it is seconds, not an audit step) |
| `hub doctor --only Leads --canary` | Also sends each form's signed canary (below). The check an agent runs before it reports a site change done (`app/@rules/agent-guardrails.md` rule 9) |
| `hub doctor --only Leads --json` | The same rows as JSON, for a scheduled report |

Rows: `leads.config` (the file parses), `leads.registry` (every registry domain has a form or an explicit `none`), then one row per form, `leads.<id>`. All forms are checked at the same time; a row names the first thing that failed. The skill that runs it and explains a red row is `skills/lead-form-check`.

**Time and network failures.** Every request (page, each script, endpoint, canary probe and POST) has its own 5 s; a request that throws (a timeout, a reset, a DNS failure) is retried once, an HTTP status is an answer and is not retried. A form stops at 25 s in all. The row's time is that form's own wall time (all forms run together, so the doctor's clock would show 0.0 s after the first row). A failure names both attempts and their time, for example `endpoint ... unreachable: no answer within 5 s, twice (2 attempts, 10.0 s)`; `(on the retry)` after a status means the first attempt failed. Before core 0.12.3 one 5 s budget covered the whole form, so a page of 2 s with 35 script chunks left the endpoint GET an expired signal: "no answer within 5 s" after 0.0 s while the endpoint answered in 1.5 s.

## What a row proves

GET half (no write anywhere):
1. The page answers 200 (a redirect is followed and noted).
2. A `static` form carries every listed field (`name="..."` in the served HTML). A `client` form is rendered by script, so its fields are not checked.
3. The page or one of its own scripts names the endpoint: its host when the endpoint is on another origin, its path when on the same. A page that posts somewhere else (or nowhere) fails here.
4. The page's CSP (header or meta) lets a script reach the endpoint (`connect-src`, else `default-src`). No CSP passes.
5. Turnstile, when the entry sets it: the widget is on the page (with the sitekey when given) and the CSP allows `challenges.cloudflare.com` for scripts and frames.
6. The endpoint answers a GET with anything but 404 or 5xx (a POST-only handler says 405, a signed-in one 401). A redirect is a WARN: it may drop the POST.

Canary half (`--canary`), per form whose entry has `canary.mode: "signed"`. Contract, both sides:
1. **Probe, no write.** `OPTIONS <endpoint>` with `X-Canary-Probe: 1`. A handler that implements the canary answers with the header `X-Canary-Accept: v1`. Without it the hub sends **no POST** (an unaware handler would store a real lead and mail it) and the row is a WARN: "canary not supported by endpoint".
2. **The canary.** `POST <endpoint>`, JSON, header `X-Canary: <unix seconds>.<hex HMAC-SHA256(secret, "<unix seconds>")>` and a fresh `Idempotency-Key`. The secret is the file `state/secrets/<secretRef>` (mode 600), the same value as in the site's environment. Body: the listed fields filled with plain test values, the address `canaryEmail` with `{id}` replaced by the form id (our own domain, never a client's), the honeypot empty, plus the entry's fixed `canary.body`.
3. **The handler** accepts a signature within 5 minutes, skips Turnstile siteverify and nothing else of validation, stores the row marked `metadata.test` and sends nothing outbound (no email, messenger, autoresponse, CRM or Notion write). It resolves the delivery in dry mode and answers 2xx JSON `{ "stored": bool, "recipient_ok": bool, "route_ok": bool, "id": "..." }`. Test rows are left out of analytics and queues and purged after 24 h by the site.
4. **The row:** PASS when all three are true; FAIL naming the false one (`recipient_ok=false`: a real lead would reach nobody). A missing secret file or `canaryEmail` is a WARN "canary not run". An unrun canary is not a pass: rule 9 says so.

Silence half (every run, read only), per form whose `silence.source` is not `none`: when did a lead last arrive where the form lands?
- `notion-leads`: the newest `Received at` in the Leads database of `silence.project` (its `## Notion databases` line `leads`, its `notion.token_file`), filtered by the `Brand` option `silence.brand` (a name of that project's `## Brands` rows, doc 16 section 3C) and, when two forms share a brand, the `Form` text `silence.form`.
- `mailbox`: the newest notification mail in `silence.account` (default `config/config.json` `account`), `silence.mailbox` (default `["INBOX"]`; `["All Mail"]` on a Google account keeps archived mail in view), matching `sender` and/or `subject`, through mail-mcp (the Apple Mail read path; no IMAP).
- Threshold: `silence.days`, or when null max(14, 3 x the median gap of the last 90 days); fewer than 3 leads in 90 days cannot be measured and is a WARN saying to set `days` or `none`. Mail.app may hold less than 90 days, so a measured threshold from a mailbox is set by hand into `days`.
- A lead older than the threshold is a WARN (`silence: no lead for N d (newest <date>)`), never a FAIL: a quiet week is normal on a small site. An unreadable source is a WARN `silence not checked`. Only dates are read and printed, never a name, an address or a message.

## `config/lead-forms.json`

One entry per page; adding a form is one entry. Tracked in the instance repository, so it holds no secret: `secretRef` names a file in `state/secrets/`.

```json
{
  "registry": "../site-registry.md",
  "canaryEmail": "canary+{id}@example.com",
  "forms": [
    { "id": "example-contact", "domain": "example.com", "page": "https://example.com/contact",
      "endpoint": "https://api.example.com/inquiries/submit/", "render": "static",
      "fields": ["name", "email", "message"], "honeypot": "website", "turnstile": false,
      "canary": { "mode": "signed", "secretRef": "example-canary", "body": { "site": "example" } },
      "lands": ["django:inquiries", "mail:lead_email", "notion:leads"],
      "silence": { "source": "none", "days": null } }
  ],
  "none": [ { "domain": "docs.example.com", "reason": "documentation, no form" } ]
}
```

| Key | Meaning |
|---|---|
| `registry` | Optional. A Markdown site registry, relative to the instance root. Every host in its tables' first column needs a form `domain` or a `none` entry, else `leads.registry` is a WARN naming it |
| `canaryEmail` | The canary's address, `{id}` = form id. Required by `--canary` |
| `forms[].render` | `static` (default): fields are checked; `client`: the form is drawn by script |
| `forms[].turnstile` | `false`, `true`, or `{ "sitekey": "..." }` |
| `forms[].canary` | `mode: "signed"` with `secretRef`, or `mode: "none"` with the reason in `notes` (a signed-in form, say) |
| `forms[].lands` | Where a submission lands, in words. For the reader; not checked |
| `forms[].silence` | The receiving-side check: `{ "source": "notion-leads", "project", "brand", "form"?, "days" }`, `{ "source": "mailbox", "account"?, "mailbox"?, "sender"?, "subject"?, "days" }` (sender or subject required), or `{ "source": "none", "reason" }` for a form with under one lead a month or no readable landing |
| `none[]` | A registry domain that deliberately has no form here, with the reason (no form, or another instance checks it) |

The doctor row `leads.config` fails on a file that does not parse and names the key.

## A scheduled report (optional, the owner's)

The core schedules no job (manual-first) and has no installer for one: its own LaunchAgent (P67, decision 0033) only starts the admin and API server at login and runs no check, and mail-mcp is a Homebrew service the owner starts. An owner who wants to hear about a broken form between sessions (owner decision 4 of P46: a run that only reports, never sends to a client) schedules this one command himself, with whatever scheduler he already uses, and reads its output:

```
cd <instance> && ./run.sh doctor --only Leads --canary --json > state/leads-report.json
```

It writes nothing but that file: the GET half reads, the silence half reads, and the canary is a test row the site marks, sends nowhere and purges after 24 h. Every handler listed in both instances implements the canary (P46 L2), so `--canary` belongs in it; drop it to stay GET only. Exit code 1 means a FAIL row; a WARN (a quiet form, an unrun canary) exits 0, so read the rows. Do not run it more often than hourly: a canary has its own ceiling of 30 an hour per site.

## Related

- The rule: `app/@rules/agent-guardrails.md` rule 9. The skill: `skills/lead-form-check/SKILL.md`.
- Where a lead lands in the CRM and who writes it: [21-leads.md](21-leads.md). The secret file: [`../setup/access.md`](../setup/access.md).

Update this page when the architecture changes.
