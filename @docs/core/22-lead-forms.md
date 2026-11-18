# Lead forms: the check that a lead still arrives

Layer: core. The list of forms is the instance's own (`config/lead-forms.json`); the check, the canary contract, the rule and the skill are core.

A site's tests run in process. They cannot see a DNS record, a CSP header, a proxy, a CDN rule or a Turnstile key that stops every form in production, and nobody is told. The `Leads` doctor group looks at each public form from outside, the way a visitor's browser does.

## Run it

| Command | Does |
|---|---|
| `hub doctor --only Leads` | GET only: the default. Also part of plain `hub doctor` and `hub doctor --fast` (it is seconds, not an audit step) |
| `hub doctor --only Leads --canary` | Also sends each form's signed canary (below). The check an agent runs before it reports a site change done (`app/@rules/agent-guardrails.md` rule 9) |
| `hub doctor --only Leads --json` | The same rows as JSON, for a scheduled report |

Rows: `leads.config` (the file parses), `leads.registry` (every registry domain has a form or an explicit `none`), then one row per form, `leads.<id>`. All forms are checked at the same time, 5 s each; a row names the first thing that failed. The skill that runs it and explains a red row is `skills/lead-form-check`.

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
| `forms[].silence` | The receiving-side check (`notion-leads`, `mailbox`, or `none`). Only `none` is acted on today: the readers are not built |
| `none[]` | A registry domain that deliberately has no form here, with the reason (no form, or another instance checks it) |

The doctor row `leads.config` fails on a file that does not parse and names the key.

## A scheduled report (optional, the owner's)

The core runs nothing in the background (manual-first). An owner who wants to hear about a broken form between sessions schedules this one command himself, with whatever scheduler he already uses, and reads its output; it only reports and never posts to a client:

```
cd <instance> && ./run.sh doctor --only Leads --json
```

Add `--canary` once every form's handler implements the contract above. Exit code 1 means a FAIL row.

## Related

- The rule: `app/@rules/agent-guardrails.md` rule 9. The skill: `skills/lead-form-check/SKILL.md`.
- Where a lead lands in the CRM and who writes it: [21-leads.md](21-leads.md). The secret file: [`../setup/access.md`](../setup/access.md).

Update this page when the architecture changes.
