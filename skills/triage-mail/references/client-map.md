# The client map (P135, P136): when and how to redraw it

One Mermaid picture per client of their goals, what is open and what we did. The Hub keeps it, shows it in Mail and Messengers
and copies it to the client's Notion page; it is always the whole picture, redrawn, never a node appended. Writing a map sends
nothing. The shape the tool accepts is `client_map`'s `map` field and `@docs/core/29-client-map.md`.

## When (verdict 2)
Redraw after each of these, for the client it concerns:
- a draft you wrote (Mail or a messenger);
- a reply the owner sent that you see (ours is the newest message of the thread or chat, and no draft of yours was it);
- an inbound message that brings a new fact: a decision, a price, a date, a refusal, a new question.

Not for spam, a notice, "thanks", "ok" or a message that changes nothing: the map stays.

## How (verdicts 1, 3, 4): read first, redraw from scratch, by the checklist
1. `client_show` with the client's id: its `map` is the current one (its `%% src` lines say what each node rests on).
2. Redraw the whole map from what you read now (the history, not only the newest message), by this checklist:
   - the root is the client (the company, else the person);
   - level 1 is the client's outcomes in their words ("Move in by March"), not our tasks ("Send listings");
   - every leaf is a concrete action or answer with its state: `open`, `waiting`, `done`, `blocked`;
   - a `waiting` leaf names who is awaited ("Bank's valuation awaited", "Their signed form awaited");
   - a branch done for 30 days or more collapses into one `Done` node under the client (its reason in `why`);
   - ids stay stable (`p1`, `p1a`, `p1a1`): the same matter keeps its id when its label or state changes.
3. Evidence: under the nodes, one line per node below the client, `%% src <id>: <ref>[, <ref>]`. A ref is the Message-ID of
   the message it rests on (`message_show`'s `messageIdHeader`), or for a chat, a call or a meeting the day and the channel
   (`2026-11-20 telegram`, `2026-11-21 call`). Never invent one: a node you cannot source is a node you do not draw.
4. `client_map` with `client` (its id) and `map`. A node of the current map you remove or rename needs a reason in `why`
   (`{"p2a": "merged into p2b"}`); the tool refuses without it (`map_why_missing`) and the old map stays.
5. Read its answer: `diff` (added, removed, renamed, states) is what changed; when it shows a change you did not mean, redraw.
   `map_invalid` names the line to fix: redraw and call once more.

The Notion `Next step` follows the map (the open leaf with the nearest date, else the first open leaf): never write it yourself.
