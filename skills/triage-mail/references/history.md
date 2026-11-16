# Client history
Goal: the whole correspondence with one address, chronological, inbound and outbound.
- Via mail-mcp it is NOT cheap: `find_messages` filters sender and subject only (no recipient), so outbound mail cannot be found by
  client address; it returns a ~100 char preview; limit 1-1000, no offset (page with dateAfter/dateBefore);
  `get_message_content` is about 2k tokens of headers per message. Take inbound by sender, outbound from the project's Sent mailbox
  after the newest inbound.
- Subject is never used to link messages.
- Mail.app lags Gmail by minutes; overlap the window.
