# Trap checklist (notion-project-deploy, every run)

- [ ] Parent `in_trash` checked before anything (trap 4).
- [ ] Status columns are `status` properties (trap 1); the DDL differences of trap 15 are listed as `differs`.
- [ ] Cross-database formulas skipped with a caveat in the report, not patched one by one (trap 2).
- [ ] A moved or re-created database loses its grant: teamspace re-shared, one row read (trap 3).
- [ ] Select and multi_select options passed in full and read back; missing ones added with `notion-update-data-source` (trap 5).
- [ ] View filters built from property ids fetched in this run (trap 6).
- [ ] Sequential creates, one retry policy, no duplicate on retry (trap 10).
- [ ] `project.md` lists data source ids, not database ids (trap 11).
- [ ] Nothing deleted, nothing moved, no row touched.
