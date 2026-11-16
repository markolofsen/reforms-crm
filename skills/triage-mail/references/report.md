# Report columns
Table: `# | клиент | класс | действие | черновик | запись | основа`, same as `skills/README.md` "Report". `основа` is built from the subagent's or the chain's own counts: "6 пис., профиль, 2 факта", "профиль пуст, 3 пис.", "нет данных" (red: nothing was read).
"Нужно от тебя": every client with `evidence != ok` is a P1 line (`[P1] клиент c3 | основа не подтверждена | скажи: прочитай заново c3`); every empty or absent profile is a P3 line (`[P3] профиль c5 пуст | Notion clients | заполни профиль <клиент> в Notion`).

# Log line
Appended to the client page under `## Log` (one per inbound message; `msg` makes a rerun idempotent):
`- YYYY-MM-DD | msg=<thread-id> | <n> msgs | class: <class> | action: <action> | profile: <field old->new or none>`
Client schema: read it from the project's `clients` source at the start of step 6 (`notion-fetch`); the names differ between CRM templates (`Conversation summary` or `Summary`, `Relationship` or `Stage`). Fields described "Filled by CRM" are never written by the assistant.
