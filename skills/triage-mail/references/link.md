# Link a Drive item or a calendar event onto the client's Notion profile (P62)

> Layer: **core**. Used by `triage-mail` and `calendar` when the owner says so ("привяжи эту папку Drive к клиенту X",
> "добавь этот документ клиенту", "запиши звонок в профиль"). The map of what a session reaches: `@docs/core/26-capabilities.md`.

One operation: find the item through the connector this project attaches (the capabilities line names it), then write ONE link with the
session's Notion writer. A link only: never share, copy, move or create a file, never change a permission, never invite anyone. The link is
visible to the Notion workspace; who can open the Drive item stays as it was.

1. **Resolve the item** (Drive connector, read only): a URL or an id the owner gave → `get_file_metadata` (id, name, mime type, link). A name
   → `search_files` (inside `drive.folder` when the project lists folders: the guard refuses a search outside them), then show at most three
   hits and let him pick; never pick silently. No Drive connector attached: say so ("Drive не подключён к проекту") and stop; never look for
   another way in.
2. **Resolve the client**: the Notion Clients page of this project (as `triage-mail` step 6 finds it). None: ask; never create a client for a link.
3. **Write, by what the item is:**
   - **A folder** (`application/vnd.google-apps.folder`) → the Clients page's `Drive folder` (url). Empty: write it. The same URL: nothing to do.
     A different URL already there: show both and write only after his "да".
   - **A file** → one row in the project's Documents database: `Document` = the file's name, `Document link` = its URL, `Type` = the type he
     names, else `Other`, the client in Documents' relation to Clients (found by its target, the project's `clients` data source,
     not by name: a CRM may call it `People`), and the client's project in `Projects` when the database has it. A row with that `Document link` already exists: add the client to its `Clients` if missing,
     never a second row. One file per row; a folder is never a Documents row.
   - **A calendar event** (the calendar connector's `get_event`, or a hold the `calendar` skill just created) → append one dated line to the
     client's page body: `Next call: <date> <time> <zone>, <event url>`. A Tasks row (`Due`, `Client`, `Doc link`) only when he asks.
4. **Never** write `Follow-up on` or another machine field (dates, the send stamp, ids; the client profile is yours: `profile.md`), never a file's content into Notion. A fact read in a Drive file is
   not a knowledge fact: it is not stated in a draft as one; to become one it goes into `knowledge/files/` through `kb-review`
   (`@docs/core/16-projects-and-knowledge.md`).
5. **Report** one line in Russian: what was linked where ("Папка «Dan Wright» → Clients/Dan Wright, Drive folder"), or why not.

Update this page when the architecture changes.
