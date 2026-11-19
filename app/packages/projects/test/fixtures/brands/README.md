# Brand fixtures (P60)

`mail-138994-headers.txt`: the header block of a real forwarded mail (Mail id 138994 in the shared mailbox, read with
mail-mcp `get_message_content` on 2026-11-19), the recipient and routing headers only: no body, no DKIM or ARC blocks.
`one-mailbox.md` and `two-accounts.md`: project files shaped like the two live instances (one shared mailbox with
forwarded product domains; one project with two real Mail accounts and aliases). `cases.json`: what `resolveBrand` must
answer for each header set. Names live here, not in test code (`@docs/LAYERS.md`).
