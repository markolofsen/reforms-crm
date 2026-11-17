# Views

Source: the six live Leads views fetched as JSON on 2026-11-14 via the Notion MCP (`notion-fetch`); the view lists in Help / Modules pages (Sales and Clients, Leads, Tasks, Knowledge, Documents (reports included), Expenses, Business contacts), read the same day. Every database has JSON in `views/`.

## How a view is written

The Notion MCP shows a view as JSON; `notion-create-view` and `notion-update-view` take the same shape. Sample (Leads, `Needs reply`):

```json
{
  "name": "Needs reply",
  "type": "table",
  "dataSourceUrl": "collection://<leads data source id>",
  "advancedFilter": {
    "type": "group", "operator": "and",
    "filters": [
      { "type": "group", "operator": "or", "filters": [
        { "type": "property", "property": "Status", "propertyType": "select", "operator": "enum_is", "value": { "type": "exact", "value": "New" } },
        { "type": "property", "property": "Status", "propertyType": "select", "operator": "is_empty" } ] },
      { "type": "property", "property": "Received at", "propertyType": "date", "operator": "date_is_on_or_before", "value": { "type": "relative", "value": "yesterday" } }
    ]
  },
  "sorts": [ { "property": "Received at", "direction": "ascending" } ],
  "displayProperties": ["Name", "Received at", "Source", "Email"]
}
```

- Types seen: `table`, `board` (with `cardLayoutMode`, `groupBy` on a select, `fullWidthProperties`).
- `groupBy`: `{ "property": "Owner", "propertyType": "person", "sort": { "type": "manual" } }`.
- Operators seen: `enum_is` (select value `exact`), `is_empty`, `date_is_on_or_before` (relative `yesterday`), group `and` / `or`, nested groups.
- A filter names the property; creation through the API needs the **property id** (see `10-api-traps.md`): read ids with `notion-fetch` on the data source right before creating the view.
- `displayProperties`: only the columns needed to act. Put a new property into a view only when a person acts on it.
- The first view in the list is the default view.

## Views per database (name: filter / sort / grouping)

Verified live JSON exists in `views/<db>.json` for all 13 databases (read 2026-11-14 through `notion-fetch` of each database). `displayProperties` are cut to acting columns for Deals, Organizations, Open loops, Participants, Workflows, Tasks and Clients, and are the full live column lists for Leads, Knowledge, Documents, Business contacts, Expenses and Payments. The JSON wins over the words below; the words stay as a reading aid.

**Leads** (JSON in `views/leads.json`): Inbox (Status = New or empty; Received at desc; default), Needs reply (as above), In progress (Status = In progress; group by Owner; sort Next step asc), Board (board, group by Status; Received at desc), All (no filter; Received at desc), Won no client (Status = Won and Client empty; Received at asc).

**Clients** (live, 9 views, in this order): Today (not Do not contact, and Follow-up on today or earlier or Waiting since set, not Synthetic; sort Waiting since asc), Waiting (Waiting since set, not Synthetic; group Waiting band), New leads (Relationship = Lead), By island (board, group Islands, not Synthetic; vertical), Partners (Type set, not Synthetic), Do not contact, Needs review (not Synthetic), All (no filter; Last two-way contact desc), No task (the `No task` formula true; Last two-way contact desc). The live order puts Today first; keep it.

**Deals** (live, 13): Buyers, Sellers, Partners (Developers + Referral partners) are boards grouped by Stage, open stages only; Closing (Stage Contract or Firm / Pending), At risk (At risk or Stuck), Hot (Warm, Hot, Offer), Closed, Needs review, All, No task (formula; Priority desc), By pipeline (board), Stuck (Stage since over one month ago, excluding the six closed stages and On hold), No contact (Client empty). The pack's earlier "Hot / At risk / Stuck / No contact" names are right; Buyers, Sellers, Partners, Closing, Closed and Needs review were missing.

**Open loops** (live, 3): Owner owes (Who owes = owner, Done unchecked; Due asc), Waiting on others (Who owes Client or Other, Done unchecked), Overdue (formula). The earlier "Open promises" name does not exist live.

**Organizations**: All. **Participants**: Default view (table, no filter).

**Tasks** (live, 12): Board (open, grouped by Status, Due asc), Today (open, Due today or earlier), Week (open, Due within the next week), Waiting (Status = Waiting; group Waiting on), Inbox (Status = Inbox; Created desc), Done (Done or Cancelled; Last edited desc), All, By client (open; group Client), My tasks (Assignee = me, open), By area (open; group Area), Needs area (Area empty, open), By project (open; group Project; only with Projects). "Open" = Status not Done and not Cancelled. Live first view is Board; the pack's earlier default "My tasks" is a choice, not the live order.

**Knowledge**: All (group by Category), Needs approval (Approved unticked), `<owner> to confirm` (Use = MARKER or Valid until passed), Sync problems (Sync state conflict or rejected), Playbooks (group by Audiences).

**Documents** (reports included; read live in saas and realty 2026-11-17): All documents (Last edited desc, default), Current (Status = Current; operator `enum_is` on a select Status, `status_is` where Status is a status property), By type (group Type), Reports (Type = Report; Date desc). The old Reports views (All reports, By person, By team participant) are gone. **Business contacts**: All contacts (Name), By category. **Expenses**: Active, Due in 30 days, By category, No next date, All. **Payments**: Last 30 days, Planned, Paid, All. (JSON in `views/`)

**Sales page `Today` block** (linked views of the above, not copies): To do (Tasks: Area = Clients or Client or Deal set; Today, Week, Waiting), Follow-ups (Clients: Today, Waiting, No task), Pipeline (Deals: No task, Hot, At risk), owner-owes (Open loops: Owner owes).

Operators seen in the live JSON, beyond those above: `enum_is_not`, `checkbox_is`, `checkbox_is_not`, `is_not_empty`, `date_is_before` (relative `one_month_ago`), `date_is_within` (relative `the_next_week`, or `custom` with count, direction, unit), `person_contains` (relative `me`), `status_is`, `status_is_not` (values `{"type":"is_option","value":...}`), `every` on a formula with a `resultFilter` (how a formula checkbox is filtered). `groupBy` on a `status` property uses `{"groupBy":"option",...}`.

## Page templates (recreate by hand, the API creates database pages from a template only on request)

Tasks: none required (the live nine are migration artefacts). Documents: `Conversation report` (Type = Report). Others: none.
