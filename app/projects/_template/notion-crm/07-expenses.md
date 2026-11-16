# Expenses and Payments

Source: Help / Modules / Expenses. Read 2026-11-14 via the Notion MCP. Optional module.

Purpose: simple cost control: what we pay for, what we already paid, what is due next. Two databases: Expenses (something we pay for, once or regularly) and Payments (one time money went out or is expected to). One expense per payment is intended; an expense has many payments. Notion is the source; a bank, card or invoice integration is planned.

Machine-readable: `schema/{expenses,payments}.json`, `views/{expenses,payments}.json` (read live 2026-11-14; the JSON wins). Live differences from the tables below: Expenses has no `Done` or `Needs review` checkboxes (both are Status options); `Paid total` and `Last paid` are rollups of Payments helper formulas `Paid amount` and `Paid on`; Payments `Vendor` and `Category` are rollups through `Expense`, not formulas. Formula source text is not exposed by the MCP, so the formulas are described from their Notion descriptions (not read).

## Expenses (title `Expense`)

| Property | Type | Writer |
|---|---|---|
| Expense | title | people, integration |
| Vendor, Category | select | people |
| Status | select: Active, Trial, Paused, Cancelled, Done, Needs review | people |
| Billing | select: Monthly, Quarterly, Yearly, Usage-based, One-time | people, integration |
| Amount | number (per period, taxes included) | people, integration |
| Currency | select | people |
| Next payment | date | people, agents, integration |
| Paid by | person | people |
| Owner | person | people (decides whether we keep it) |
| Auto-renews | checkbox | people |
| Billing page | url | people |
| Started | date | people |
| Notes | text | people |
| Done, Needs review | checkbox | people |
| Monthly cost | formula: per-month equivalent for Active (yearly / 12, quarterly / 3) | formula |
| Paid total, Last paid | formula/rollup from Payments, same currency only | formula (cross-database: see traps) |
| Tasks | relation to Tasks | set from Tasks.Expense |

## Payments (title `Payment`)

| Property | Type | Writer |
|---|---|---|
| Payment | title, `<Expense> - <Mon YYYY>` | |
| Expense | relation to Expenses, limit 1; empty for review if no match | |
| Date | date: when money left (Paid) or is expected (Planned) | |
| Amount | number, positive | |
| Currency | select | |
| Status | select: Planned, Paid, Refunded, Cancelled | |
| Paid by | person | |
| Invoice | files | |
| Notes | text | |
| Source | select: Manual, Agent, Integration | |
| External id | text; idempotency key of the integration; never edit | integration |
| Vendor, Category | formula copied from the expense | formula (cross-database) |

## Views

Expenses: Active (includes Trial; default), Due in 30 days (Notion's next-month relative filter, not an exact 30 days), By category, No next date, All. Payments: Last 30 days, Planned, Paid, All. On the Expenses page: Due in 30 days and Planned payments. Turn on Sum for Monthly cost and Amount in the footer; group by Currency so totals never mix currencies.

## Recurring payments and integration contract

Each regular expense has one Next payment. When a payment is recorded, move Next payment forward one period (workflow Record a payment). Cancelled expenses keep their rows; clear Next payment. An integration looks up by External id first (update, never duplicate), sets Payment, Expense, Date, Amount (positive), Currency, Status, Source = Integration, External id; a refund is a new payment with Status = Refunded and a positive Amount; no matching expense means Expense stays empty with a note. Tasks for finance work: Area = Finance and link Expense.
