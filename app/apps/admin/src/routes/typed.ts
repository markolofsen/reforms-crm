import type { Route } from "next";
import { PAGE } from "./table";

/**
 * The one door from a string to a Next `href`. The generic keeps the template literal's shape, so
 * `route(`/drafts/${id}`)` is checked against the file tree by `typedRoutes` and `route("/draftz/1")` fails `tsc`
 * (measured in P32 N0). Destinations are built from it in `paths.ts`, never in a component.
 */
export function route<T extends string>(path: Route<T>): Route<T> {
  return path;
}

// The pages of the file tree as one pattern (derived from `ROUTE_TABLE`), for addresses that exist only at run time
// (`/drafts/42?project=x`): the router's typed routes refuse a bare `string`, so the address is checked here and only then is it a `Route`.
function isRoute(address: string): address is Route {
  return PAGE.test(address);
}

/** An address text that names a page of the tree, as a `Route`; null for anything else (the caller does not navigate). */
export function routeOf(address: string): Route | null {
  return isRoute(address) ? address : null;
}
