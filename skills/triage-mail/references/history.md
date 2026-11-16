# Client history
Goal: the whole correspondence with one address, chronological, inbound and outbound.
- Via mail-mcp it is NOT cheap: `find_messages` filters sender and subject only (no recipient), so outbound mail cannot be found by
  client address; it returns a ~100 char preview; limit 1-1000, no offset (page with dateAfter/dateBefore);
  `get_message_content` used to carry about 2k tokens of raw headers per message; the `hub guard --post` hook now cuts them to ~10 lines (reply-to, list-unsubscribe, one authentication-results...), so a read costs about a third. Take inbound by sender, outbound from the project's Sent mailbox
  after the newest inbound.
- Subject is never used to link messages.
- Mail.app lags Gmail by minutes; overlap the window.
