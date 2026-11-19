// Type test: `pnpm typecheck` fails if one of these lines stops being an error (an unused @ts-expect-error is an error).
// Each line is a mistake a component could make; the builders and the typed-route door must refuse it at compile time.
import type { LinkProps } from "next/link";
import { paths } from "../src/routes/paths";
import type { NavCheck } from "../src/routes/table";
import { route } from "../src/routes/typed";

// @ts-expect-error a draft id is a number, not a string
paths.drafts.item("abc");
// @ts-expect-error a batch is a number, not its name
paths.drafts.list({ batch: "June" });
// @ts-expect-error there is no Bulk screen: a batch is a filter of Drafts
paths.bulk.list();
// @ts-expect-error the batch builder is gone (P48): a batch is prepared by a phrase in a session
paths.drafts.newBatch();
// @ts-expect-error not a route of the tree
paths.drafz.list();
// @ts-expect-error a filter outside its enum
paths.drafts.list({ filter: "readyy" });
// @ts-expect-error `run` belongs to the log, not to Drafts
paths.drafts.list({ run: 3 });

const id = 42;
// @ts-expect-error a path that is not a page of the file tree (typedRoutes, P32 N0)
export const badPath = route(`/draftz/${id}`);
// @ts-expect-error a bare string that is not a page of the file tree
export const badLiteral = route("/nope");

// The valid forms compile.
export const ok = [route("/settings"), route(`/drafts/${id}?x=1`), route("/settings/mac?x=1")];
// @ts-expect-error the Project section is gone (P70): its parts moved to Settings, Knowledge and Overview
paths.project.page();

// What `route` returns is a `Route`, so a link or a redirect accepts it.
export const href: LinkProps<string>["href"] = route("/settings");

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
