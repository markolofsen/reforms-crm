import { DEFAULT_BRAND_NAME, hubPaths, instanceBrand } from "@hub/config/paths";

/**
 * P133 (P128 X4): the instance's name ("Hub SaaS", `name` of `config/config.json`) for the tab title, read on the server by
 * the root layout's metadata. The admin's one read of the instance on its own (architecture rule 3a): a name for a title,
 * read per request (the owner edits the file while the admin runs), never sent to the browser as data. No instance folder
 * (a build, a bare `next start`) or an unreadable file is the default name: a title is never a reason not to render.
 */
export function instanceName(): string {
  try {
    return instanceBrand(hubPaths()).name;
  } catch {
    return DEFAULT_BRAND_NAME;
  }
}
