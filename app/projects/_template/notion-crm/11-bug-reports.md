# Bug reports

Source: P145 slice B (decision 0054), 2026-11-25. Machine-readable: `schema/bug-reports.json` (the JSON wins). Created by `hub install --only notion.bug-reports` beside Clients; listed in project.md as `bug-reports`.

Purpose: a client says the product does something wrong, and the report must not be lost in a reply. One page is one symptom in one area. Every client who reports the same symptom is added to it, with their words, instead of a second page. People triage and fix; the agent files and acknowledges.

## When a message is a bug report

- **It is one** when the client says the product does something wrong and gives an example (an id, a URL, a screenshot), or repeats a symptom already reported.
- **It is not one**: a feature request, a how-to question, a billing complaint, or "it is slow" with no example. These go to the Conversation summary, as before.
- In doubt, file it: a report without evidence is still a report, and the reply asks for the one missing piece.

## Who writes what

| Property | Writer | Rule |
|---|---|---|
| Bug | the Hub's `bug_report` tool | the symptom in one line, in the client's terms, never a cause |
| Projects | the tool | the project key (decision 0053), matched to an existing option |
| Clients | the tool | every client who reported it; added, never removed |
| Channel, Source link | the tool | from the conversation, never typed by the agent |
| Client's words, Evidence | the tool | quoted, as sent; only what the client gave or the agent saw (`link_fetch`) |
| Kind | the tool | `Product` (default; a row with none is Product), `Knowledge gap` (a client asked what the knowledge base does not answer specifically), `Workflow` (the agent could not resolve something itself). P147 3g |
| Area | the tool | `<kind>: <name>` in lower case (`parser: <source>`, `site: <domain>`, `api`, `admin`); an option is reused when its normalised form matches |
| Status | the tool sets New; then people | New, Triaged, In progress, Fixed, Won't fix, Duplicate |
| Severity, Duplicate of, Fix link, Notes | people | the agent never writes them; a cause belongs in Notes |
| Reported at, Last reported | the tool | the first and the latest report's message time |
| Client told | the Hub, at the send of the "fixed" message | a date, so it also says when |

## The tool, not the connector

The agent files through `bug_report` (the Hub MCP server), never by creating a page with the Notion connector, because the search, the Clients relation and the link must be the same every time.

1. It searches the **open** reports (New, Triaged, In progress) with the same Kind, Area and project.
2. One match: it adds the client to Clients, appends the new words and evidence to the page body as a dated block, and sets Last reported. Answer `appended`.
3. Several matches: it creates nothing and returns them; the agent names one with `into`.
4. None: it creates a report with Status New. Answer `created`.
5. The same message filed twice is one entry: the block carries the message's key, and a second call finds it.

## The reply

It acknowledges the report, says it was recorded and will be looked at, and asks for one missing piece of evidence when there is none. It promises **no date and no cause**. In autopilot the tool files but the reply's rules do not change.

## Closing the loop

A report set to Fixed with an empty Client told makes the next follow-up sweep draft a short "fixed, please check" message for each of its linked clients, in their language and channel, quoting the symptom in their words. A mail note is one more row of the day's Send all ready; a messenger note waits in its chat. The owner sends it; once every linked client was told, the Hub writes Client told with the last send's time. No message for a client marked Do not contact, or for Won't fix and Duplicate. Each client gets the note once per report.

## Views

Open (Status New, Triaged or In progress; Last reported desc; default), Fixed, client not told (Fixed and Client told empty), By area (group Area), All.

Later, not built: an agent opening a Fixed-to-be report's Area in the right repository to propose a fix.
