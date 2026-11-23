# Where each draft goes (bulk-drafts step 4)

**Reply to the newest message of the client's latest thread** (P85): theirs when they wrote last, otherwise our own last sent
message to them (in the account's Sent; find it with mail-mcp `find_messages` in INBOX and Sent, newest first). `draft_write`
kind `reply` with `message` = its account, `mailbox_path` and `message_id` (or `{inbound}`), `content`, `owner_request`, `record`.
It does not matter that the client has not answered or that our last draft was sent. A reply to our own message goes to its
recipients (the hub sets them); `no_recipient`: reply to the client's own newest message instead.

**No thread at all** (P85b: nothing in INBOX or Sent from or to their address, no hub draft): `draft_write` kind `new` with `to` =
the address from the project's Notion Clients row, `subject` (short, in the client's language), `content`, `owner_request`,
`record` (`from` only when the owner named a brand address); it goes from the project's sender. `has_thread`: the hub already
wrote to them, reply to the newest message instead; `do_not_contact`: `skipped: do not contact`; `not_a_client` (the hub checks
Notion Clients and Leads): `skipped: not a client`, said in one line. In test mode the owner's test addresses are valid
recipients of a test draft on his words (P92). Never `create_outgoing_message`.

**Open drafts and reruns.** `already_drafted` for an OPEN draft is `skipped: open-draft (draft <id>)`, never an error; revise it
(kind `revise`) only when the owner asks. A finished draft of the same message no longer refuses when `owner_request` is given.
`mail_list` / `client_show` show an open draft before you write.

**A teammate wrote (P90):** the client's newest message in Sent is not this Hub's draft and is newer than the client's last
message, or Notion `Last sent by` is another person after it: `skipped: teammate-wrote (<name>, <date>)` unless the owner named
this client.

**The record** (`skills/triage-mail/references/record.md`): `skill: "bulk-drafts"`, `excerpt` (first 240 characters of the
client's message), `notion`, `mail_class`, `injection_suspected`, and `context` with the run's `batchKey`, `batchTitle`, the brief
as `context.purpose` and honest read counts. A record that failed is reported, not retried. P87: a record without `batchKey` is
joined by the hub from `owner_request` and the day.

## A Notion lead (P97, decision 0044)
The phrase names a Notion lead ("answer their website request (Notion lead <page id>, brand <Brand>)", from the lead card's
Prepare reply). Read that Leads page by id (`notion-fetch`, never search) for the person's own words. It is always a NEW message:
`draft_write` kind `new`, `to` = the address in the phrase (else the Leads Email; never `robot@...`), `brand` = the phrase's brand,
a short `subject` in their language, `content`, `owner_request`, `record` with `notion: {"kind":"lead","page_id":"<id>"}`. Never
set the lead's Status or create a Clients card: the Hub does at his first sent reply. A lead with only a phone or Telegram gets no
draft. A lead that looks like spam: propose Spam on the card in one line, never mark it.
