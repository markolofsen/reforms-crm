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

## Every difficulty, not only bugs (owner, 2026-11-25; P147 3g; `skills/README.md` rule 18)
`bug_report` has a `kind`. File one, in addition to the reply or the hand-over and never instead, in every skill and turn:
- **Knowledge gap**: `knowledge_search` gave no specific fact for what the client asked, and the reply went out general or with
  a placeholder. `area` `knowledge: <topic>` ("knowledge: japanese auctions"); `evidence` the query you ran and the nearest fact.
- **Workflow**: you handed over, gave up, or worked around a refusal (a tool refused with no path left, a lead you could not
  classify, a missing or contradictory record, a rule that blocked a reasonable step). `area` `workflow: <tool or step>`;
  `evidence` the tool, its refusal and what you tried.
- The same kind and gist from another client appends to the open report (one row, many Clients). No `chat` or `client` yet:
  `lead` (its page id). Nothing about it is said to the client; the agent never sets Status, Severity or Notes.
