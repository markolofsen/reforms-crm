# UI composition

Scope: reusable UI in `@hub/ui` and its use in `apps/admin/src`. History: decision 0047.

## Rules

1. MUST: the smallest correct layer: a primitive owns semantics and ARIA, a product pattern layout, a feature workflow and permissions.
2. MUST: copied coss primitives import no product hook, route, API client, contract or feature code.
3. MUST: a shared product component has two real consumers or a stable cross-feature contract.
4. MUST: a connected wrapper owns the query and the commands; a view gets a typed view model and chooses no project, parses no wire data, invalidates nothing.
5. MUST: app-wide providers, the `HotkeyProvider` included, are mounted once in `apps/admin/src/app/providers.tsx`; feature hooks register with them.
6. MUST: the shared conversation frame owns the header, one history scroll and the docked composer; no feature builds a parallel one.
6a. MUST: Mail and Messengers draw one `ConversationWorkspace` (`components/conversation/workspace.tsx`) fed by a `Channel` adapter and slots; never a second workspace.
7. MUST: a focused editor owns its shortcuts; global shortcuts ignore inputs, editable content, menus and dialogs unless they opt in with an owned target.
8. MUST: conversation composers use the shared plain-text editor (`@hub/ui/product/composer/plain-text-editor`): no formatting, paste as plain text (decision 0045 point 3); the Markdown toolbar is for instruction and knowledge editors.
9. SHOULD: a coss primitive or an existing product pattern comes before new JSX; a new primitive needs an accessibility scenario.
10. MUST: a reusable product surface has a story in `apps/storybook`, in light and dark.
11. MUST: an agent surface is `AgentPanelFrame`: header and footer shrink to content, only the body flexes.
12. MUST: loading, empty, not-found and retry inside a conversation use `ConversationHistoryState`.
13. SHOULD: important truncated text uses the shared tooltip, not a native `title`.
14. MUST: a fixed split surface uses `Page`'s `flush` body.
15. MUST: Mail and Messengers lists use the shared `List*` and `ConversationList*` surfaces; rows never fork hover, selection or scroll.

## Enforcement

| Rule | Check |
|---|---|
| 1, 3-4, 6-7, 9, 11-15 | review; the conversation flows in e2e |
| 2 | `app/test/boundaries.test.ts`; the `@hub/ui` eslint |
| 5 | review of `src/app/providers.tsx` |
| 6a | `test/rules.test.ts`; review |
| 8 | rules test "the conversation composers are plain text" |
| 10 | `packages/ui/test/stories.test.ts` |

Update this page when a new shared UI layer or provider is introduced.
