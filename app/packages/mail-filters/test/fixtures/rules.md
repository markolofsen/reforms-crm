# Mail filters: acme-travel

## Rules

| Match | Category | Label | Action | Why | Date | By |
|---|---|---|---|---|---|---|
| domain:news.example.org | marketing | hub/marketing | label+skip+read | List-Unsubscribe on 4 of 4 messages | 2026-11-14 | agent |
| domain:deals.example.net | marketing | hub/marketing | label+skip+read | newsletter | 2026-11-14 | owner |
| from:noreply@ci.example.dev | service | hub/service | label+skip+read | build notices | 2026-11-14 | agent |
| list-id:updates.example.dev | service | hub/service | label | product updates | 2026-11-14 | agent |
| domain:bank.example.com | security | hub/security | label | sign-in alerts | 2026-11-14 | owner |
| domain:calendly.com | calendar | hub/calendar | label | invites | 2026-11-14 | agent |
| from:pitch@growth.example.biz | cold-outreach | hub/cold-outreach | label | unsolicited pitch | 2026-11-14 | agent |
| subject:verification code | security | hub/security | label | codes | 2026-11-14 | agent |
| domain:partner.example.com | partner | hub/partner | label | ferry operator | 2026-11-14 | owner |

## Client whitelist

Always reach the inbox, always win over a rule above.

| Match | Why | Date | By |
|---|---|---|---|
| from:jane@clientco.example | client | 2026-11-14 | owner |
| domain:bigclient.example | client domain | 2026-11-14 | owner |

## Notes

Invented data for tests.
