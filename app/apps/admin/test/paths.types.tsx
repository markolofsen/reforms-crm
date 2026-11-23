// Type test: `pnpm typecheck` fails if one of these lines stops being an error (an unused @ts-expect-error is an error).
// Each line is a mistake a component could make; the builders and the typed-route door must refuse it at compile time.
import type { LinkProps } from "next/link";
import { dest } from "../src/routes/paths";
import type { NavCheck } from "../src/routes/table";
import { route } from "../src/routes/typed";

// @ts-expect-error a conversation's client id is a number, not a string
dest("mail.conversation", { id: "abc" });
// @ts-expect-error a conversation needs its client id
dest("mail.conversation");
// @ts-expect-error P99: a draft has no address of its own; it is the unsent message of its client's conversation
dest("mail.item", { id: 4 });
// @ts-expect-error P99: a client's message is a part of the conversation, not a card (`/mail/in/<id>` is gone)
dest("mail.inbound", { id: 10 });
// @ts-expect-error a batch is a number, not its name
dest("mail.list", { batch: "June" });
// @ts-expect-error there is no Bulk screen: a batch is a filter of Mail
dest("bulk.list");
// @ts-expect-error not a route of the tree
dest("drafz.list");
// @ts-expect-error a filter outside its enum
dest("mail.list", { filter: "readyy" });
// @ts-expect-error `run` belongs to no route's search (the log's is `client`)
dest("mail.list", { run: 3 });
// @ts-expect-error a page without params takes none
dest("settings.page", { id: 3 }, {});
// @ts-expect-error a lead is a Notion page id, under `page`
dest("mail.lead", { id: 3 });

const id = 42;
// @ts-expect-error a path that is not a page of the file tree (typedRoutes, P32 N0)
export const badPath = route(`/draftz/${id}`);
// @ts-expect-error a bare string that is not a page of the file tree
export const badLiteral = route("/nope");

// The valid forms compile. P127 A2: a scoped page exists once, under `[project]`, so its literal names a project; the bare
// `/settings` is an address (served by the rewrite in `src/proxy.ts`), not a page, and only `routeOf` admits it.
export const ok = [route("/lisbon/settings"), route(`/lisbon/mail/c/${id}?x=1`), route("/settings/mac?x=1"), route("/help")];
// @ts-expect-error P127 A2: no twin pages, so a bare scoped literal is no page of the tree
export const bareScoped = route("/settings/agent");
// @ts-expect-error the Project section is gone (P70): its parts moved to Settings, Knowledge and Overview
dest("project.page");

// What `route` returns is a `Route`, so a link or a redirect accepts it.
export const href: LinkProps<string>["href"] = route("/help");

// The nav shape (P63 N1, `NAV_SHAPE` in routes/table.ts): a child names a parent row and has no chord; a parent has both. Scope
// (P70): a child has its parent's scope, or is projectless under a scoped parent; never scoped under a projectless parent.
const nav = { label: "X", icon: "mail", order: 1 } as const;
// @ts-expect-error a child whose parent is not a route
export const orphan: NavCheck<{ scoped: true; nav: typeof nav & { parent: "nope.page" } }> = true;
// @ts-expect-error a child whose parent is itself a child
export const grandchild: NavCheck<{ scoped: true; nav: typeof nav & { parent: "settings.mail" } }> = true;
// @ts-expect-error a scoped child of a projectless parent (its parent's address could not carry the project)
export const mixed: NavCheck<{ scoped: true; nav: typeof nav & { parent: "help.page" } }> = true;
// @ts-expect-error a child with a chord (chords are the parents' in v1)
export const chorded: NavCheck<{ scoped: true; nav: typeof nav & { parent: "settings.page"; chord: "k" } }> = true;
// @ts-expect-error a parent without a chord or a phone place
export const bare: NavCheck<{ scoped: true; nav: typeof nav }> = true;
export const child: NavCheck<{ scoped: true; nav: typeof nav & { parent: "settings.page" } }> = true;
// P70: a projectless child of a scoped parent (Settings ▸ Connections, This Mac) is accepted.
export const instancePane: NavCheck<{ scoped: false; nav: typeof nav & { parent: "settings.page" } }> = true;
export const parent: NavCheck<{ scoped: false; nav: typeof nav & { chord: "z"; phone: "more" } }> = true;
