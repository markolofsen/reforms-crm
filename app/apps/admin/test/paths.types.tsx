// Type test: `pnpm typecheck` fails if one of these lines stops being an error (an unused @ts-expect-error is an error).
// Each line is a mistake a component could make; the builders and the typed-route door must refuse it at compile time.
import type { LinkProps } from "next/link";
import { paths } from "../src/routes/paths";
import { route } from "../src/routes/typed";

// @ts-expect-error a draft id is a number, not a string
paths.drafts.item("abc");
// @ts-expect-error a batch is a number, not its name
paths.drafts.list({ batch: "June" });
// @ts-expect-error there is no Bulk screen: a batch is a filter of Drafts
paths.bulk.list();
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
export const ok = [route("/health"), route(`/health?x=${id}`), route("/health?x=1")];

// What `route` returns is a `Route`, so a link or a redirect accepts it.
export const href: LinkProps<string>["href"] = route("/health");
