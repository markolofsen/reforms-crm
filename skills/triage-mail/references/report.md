# Report columns
Table: `# | клиент | класс | действие | черновик | запись | основа`, same as `skills/README.md` "Report". `основа` is built from the subagent's or the chain's own counts: "6 пис., профиль, 2 факта", "профиль пуст, 3 пис.", "нет данных" (red: nothing was read).
"Нужно от тебя": every client with `evidence != ok` is a P1 line (`[P1] клиент c3 | основа не подтверждена | скажи: прочитай заново c3`); every empty or absent profile is a P3 line (`[P3] профиль c5 пуст | Notion clients | заполни профиль <клиент> в Notion`).

# Log line
Appended to the client page under `## Log` (one per inbound message; `msg` makes a rerun idempotent):
`- YYYY-MM-DD | msg=<thread-id> | <n> msgs | class: <class> | action: <action> | profile: <field old->new or none>`
Client schema: Name (title), Email, Last mail (date), Stage (lead|active|do not contact), Summary (text).
