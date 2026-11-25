# Bug report (P145, decision 0054)

A message is a bug report when the client says the product does something wrong and gives an example (an id, a URL, a
screenshot), or repeats a known symptom. A feature request, a how-to or billing question, or "slow" with no example is not
one: it goes to the Conversation summary.

1. Open their links with `link_fetch`.
2. Call `bug_report` once with `client`, `message` (the Message-ID), `area` (`parser: <source>`, `site: <domain>`, `api`),
   the symptom in their terms, their words and the evidence you saw. Never a cause.
3. `bug_report_several`: pick the report with `into` and call again.
4. The draft says it is recorded and will be looked at, asks for one missing piece of evidence if there is none, and
   promises no date and no cause.
