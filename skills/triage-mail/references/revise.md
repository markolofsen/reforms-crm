# 2r. Revise the focused draft (P51: "ответь этому клиенту", "перепиши этот черновик")

The owner looks at a draft in the admin and asks in a phrase; he never names the client. `this` of the focus says which draft
(the session rules). A vague request ("измени", "перепиши", "что угодно") is a work order: write a better version and say in one
line what changed. Only a fact the knowledge lacks is an `[Owner: ...]` placeholder.

1. `draft_show` with `draft` = its id: `mailRef`, recipients, subject, reason, evidence, client, and `mail` (the Mail versions the
   hub recorded). The body is in Mail: `list_drafts` on the project's account, the draft with that Message-ID. With
   `repliedElsewhere` (P90) or `teamSent`, revise as asked but open your line with who replied and when.
2. Steps 1, 1b, 3, 4 of section 2 for that client, in full (a revision is a reply and needs the same evidence). Words the owner
   typed after the request are his text for the reply: use them as written; pass them as `owner_request`.
3. `draft_write` kind `revise` with `draft`, `content`, and `reason` (one English line) when "Why this email" no longer fits. The
   hub finds the message it answers, saves the new unsent version, moves only the older version it recorded to Trash, and records
   the revision (`recorded: true`). Nothing else to record.
4. Report one row with the draft id and the replaced versions, and one line on what changed. A refusal: do what its `next` says,
   per its `retry`; never repeat an identical call. A `sent` draft is `already_sent`, a `done` or `skipped` one
   `draft_finished`: a NEW message to that client is `skills/bulk-drafts` for one client. Nothing is sent.
