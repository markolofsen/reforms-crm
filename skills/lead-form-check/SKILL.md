---
name: lead-form-check
description: Use when the owner or an agent needs to know that the instance's public lead forms still deliver, or has changed a site, form, CSP, proxy, DNS or Cloudflare rule and must prove it before reporting done. Runs the Leads doctor group, explains each red or yellow row and names the fix and its owner. Never submits a real lead, never fixes a site itself; unlike status, which checks the hub's own setup, this checks the forms on the public sites.
allowed-tools: Read Bash
---

# Lead form check (read only, plus the signed canary)

> Layer: **core** (universal). The forms are the instance's own list, `config/lead-forms.json`; the check and its contract: `@docs/core/22-lead-forms.md`.

Rules: `skills/README.md` ("Rules"). Talk to the owner in Russian, briefly. This skill reads no project's mail or Notion, so it needs no project binding; it works on the whole instance.

1. **Run once, from the instance root.**
   - After a change to a public site, a form, Turnstile, a CSP or security header, a proxy or CDN rule, an API route under a form's endpoint, or a DNS or Cloudflare record (`app/@rules/agent-guardrails.md` rule 9): `hub doctor --only Leads --canary`.
   - Otherwise (the owner asks "do the forms work"): `hub doctor --only Leads`. It sends GET requests only.
   - One run. Do not loop it, and never run two at once.
2. **Never submit a lead yourself.** No `curl -X POST`, no browser submit, no form fill, not even with a test address: an unaware handler stores it as a real lead and mails the desk or the client. The only POST is the doctor's signed canary, and the doctor sends it only to a handler that answers `X-Canary-Accept: v1`.
3. **Explain each row that is not PASS** in a table `форма | что сломано | где чинить | кто`:
   - `page ... answered N` / `unreachable`: the site or its DNS, proxy or CDN. The site's project.
   - `page has no field X`: the form changed or the page no longer serves it. Update the site, or the entry if the change was intended.
   - `neither the page nor its scripts reference <host>`: the page posts somewhere else or nowhere. The site's frontend (its API origin variable, or an old page still deployed).
   - `CSP <directive> does not allow <origin>`: the site's security headers.
   - `Turnstile ...`: the widget, its sitekey or the CSP for `challenges.cloudflare.com`.
   - `endpoint GET 404 / 5xx`: the API route or the backend. A redirect (WARN) may drop the POST.
   - `canary not supported by endpoint`: the handler lacks the canary contract; a WARN, and the form is NOT proven. Name it as open.
   - `canary not run: state/secrets/<ref> ...`: the secret file is missing; the owner stores it (`@docs/setup/access.md`).
   - `recipient_ok=false` / `route_ok=false` / `stored=false`: a real lead would reach nobody or no CRM. P1 for the owner.
   - `... unreachable: <error>, twice (2 attempts, N s)`: the request failed twice, with its own 5 s each; the error is the network's own (timeout, reset, DNS). Run once more only if the same host answers a browser; a second identical row is a real outage. `(on the retry)` after a PASS: the first attempt failed, worth a line, not a fix.
   - `silence: no lead for N d`: a WARN, never a FAIL; nothing arrived where the form lands for longer than its threshold. Look at the rest of the row first (a red GET half or canary explains it); if those are green, say the form works and the quiet is the market or the landing (mail filter, Notion mirror), and name which. `silence not checked`: the source could not be read (token, Mail.app, project); say what.
   - `leads.registry` WARN: a registry site has no entry and no `none`; add one to `config/lead-forms.json` in the same change.
4. **Report.** All PASS: one line "формы: N из N в порядке" with the command you ran. Otherwise the table, then one sentence: the most important fix and who owns it. A red row, or a canary that did not run, means the site change is **not done**: say which (rule 9). Paste the doctor rows into the contract (rule 8).
5. You change nothing: not the site, not `config/lead-forms.json` (unless the owner asked you to add or correct an entry), not a secret.

Scheduling: the core schedules nothing. The one command an owner may put on his own scheduler is in `@docs/core/22-lead-forms.md` ("A scheduled report").
