# Hub Storybook

The component theatre for the core UI package, running Storybook `10.6.8`.
Stories compose the real public exports from `@hub/ui`; they do not copy admin
feature code, import generated clients or call project APIs.

## Commands

```sh
pnpm --filter @hub/storybook storybook
pnpm --filter @hub/storybook build
pnpm --filter @hub/storybook typecheck

# from the core workspace root
pnpm storybook
pnpm storybook:typecheck
pnpm storybook:build
```

Set `STORYBOOK_PORT` when another local port is needed; the default is `6006`.

The stories cover the shared product contracts used by the core app:

- the agent panel built from the resizable dock, terminal and dictation button;
- the fixed-height Mail/Messenger split view, stable list viewport and conversation states;
- the brand-aware Mail composer with the visual Tiptap Markdown editor;
- message direction, safe text/URL rendering, language selection and filters;
- page/list-detail shells, tooltip behavior, toast feedback and light/dark theme controls;
- reusable data tables, fields/progress, channel icons and agent spotlight.

Use the toolbar and viewport controls to review light, dark and narrow states.
The a11y addon runs in error mode, so a story with an accessibility violation
is not an acceptable visual contract. Conversation composers use the restricted
mail toolbar; the standalone Markdown story also keeps the full editor visible
for instruction-oriented surfaces.

`AgentPanelFrame` is the shared three-zone shell: its header and footer are
fixed chrome, and only its body is flexible. Terminal history, dictation and
session status belong inside those zones rather than adding another outer
scroll container or pinned footer in a feature.
