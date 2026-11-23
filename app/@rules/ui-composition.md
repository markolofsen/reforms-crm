# UI composition

Scope: reusable UI and product composition in `@hub/ui` and
`apps/admin/src`. This page complements the visual and accessibility rules; it
does not own API, Query or permission semantics.

## Rules

1. MUST: choose the smallest correct layer. A primitive owns semantics,
   keyboard behavior and ARIA; a product pattern owns reusable layout and
   visual composition; a feature owns workflow, data mapping and permissions.
2. MUST: copied coss primitives remain source-compatible copies. They do not
   import product hooks, routes, API clients, domain contracts or feature code.
3. MUST: a shared product component has either two real consumers or a stable
   cross-feature contract. Do not create a generic wrapper to hide one
   feature's unresolved state mapping.
4. MUST: connected/view separation is explicit. A connected wrapper owns the
   Query subscription and named commands; a view receives a typed view model
   and renders it without choosing a project, parsing wire data or invalidating
   cache.
5. MUST: application-wide providers are mounted once in
   `apps/admin/src/app/providers.tsx`. This includes theme, Query, tooltip /
   overlay, feedback and the `@hub/ui` `HotkeyProvider` registry. A feature
   may receive a stable capability context only when its lifecycle is
   documented; feature hooks register with the provider instead of adding
   competing page-wide listeners.
6. MUST: the shared conversation frame owns the header, one history scroll
   container and bottom-docked composer. Mail and Messenger may map different
   domain states into it, but must not create parallel scroll or composer
   mechanics. Optional header identity metadata goes through
   `ConversationHeaderFacts`, which owns separator rhythm and omits absent
   facts.
   Existing draft editors reuse `ConversationEditorSurface` inside the
   already-owned composer; they must not wrap that surface in another
   `ConversationComposer` or introduce a second editor shell. The shared
   `ConversationComposer` owns body padding and scroll directly; it does not
   expose a feature-level body class override. A stale
   conversation keeps its last history and uses `ConversationStaleNotice` for
   error detail and retry; features must not create a parallel banner layout.
7. MUST: editors own shortcuts while focused. Global shortcuts ignore text
   inputs, content-editable elements, menus and dialogs unless a shortcut
   explicitly opts in; an opt-in must also provide an owned target predicate
   when the control is mounted beside other typing surfaces. The editor may
   prevent the browser command before the global dispatcher sees it.
8. MUST: conversation composers (Mail's and Messengers' reply, message and
   draft editors) use the shared plain-text editor
   (`@hub/ui/product/plain-text-editor`, through `composer-editor.tsx`): no
   formatting buttons, a paste arrives as plain text. Why: nothing turns
   Markdown into the client's formatting yet, so a bold word would reach the
   inbox as `**word**` (P123 U0, decision 0045 point 3). P93's RTF write and
   canonical read-back bring the `mail` Markdown preset back here. The full
   Markdown toolbar remains for instruction and knowledge editors. Product
   features must not pick an editor of their own.
9. SHOULD: use a coss primitive or an existing `@hub/ui/product` pattern
   before adding JSX. A new primitive requires an accessibility scenario and a
   reason why the existing component cannot express it.
10. MUST: reusable `@hub/ui` product surfaces have a story in
   `apps/storybook`. Stories compose public package exports with local state and
   fake callbacks; they do not import project APIs, generated clients, feature
   facades or runtime sessions. The preview uses the shared providers and
   exposes light and dark theme states.
11. MUST: an agent surface uses `AgentPanelFrame` with three explicit zones:
    header and footer are shrink-to-content chrome, while only the body owns the
    flexible `min-h-0` area. Terminal history, dictation and session status stay
    inside that contract; a feature must not add a second outer scroll container
    or a second pinned footer around them.
12. MUST: loading, empty, not-found and retry states inside a shared
    conversation use `ConversationHistoryState`. It owns full-height centering
    and breathing room; features provide only the state content and must not
    add a second history scroll, viewport height or competing padding system.
13. SHOULD: truncated user-facing context uses the shared TooltipProvider
    rather than a native `title` hint when the full value is important. Keep a
    native title only as a deliberate primitive or browser fallback, not as a
    second tooltip implementation in a product feature.
14. MUST: fixed split surfaces use `Page`'s `flush` body mode instead of
    reproducing zero-padding and overflow overrides in feature class names.
15. MUST: compact Mail and Messenger contact lists use the shared `ListToolbar`
   for sticky list chrome, `ListScrollArea` for the one list viewport,
   `ConversationList` for the semantic contact-list boundary, and
   `ConversationListItem` plus `ConversationListIdentity` for row surfaces.
   Feature rows own domain content and actions, but must not fork hover,
   active-marker, border, selection, identity-line or scrollbar treatment.
   Specialized action-lists such as a link picker may keep their own semantics.

## Enforcement

- Review component placement and the connected/view boundary.
- `test/rules.test.ts` and package-boundary checks reject product imports from
  copied primitives and duplicate provider owners.
- UI scenarios cover focus ownership, keyboard behavior, light/dark themes,
  fixed frame height and independent history/list scrolling.
- Storybook build review checks the reusable surface stories and their provider
  boundary; the app is not a second owner of product components.
- List chrome review checks that Mail and Messenger keep one toolbar/row visual
  contract while their filters, status menus and data attributes remain local.

Update this page when a new shared UI layer or provider is introduced.
