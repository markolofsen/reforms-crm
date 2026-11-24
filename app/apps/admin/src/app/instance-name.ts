import { DEFAULT_BRAND_NAME, hubPaths, instanceBrand } from "@hub/config/paths";

/**
 * P133 (P128 X4, X8): the instance's name ("Hub SaaS", `name` of `config/config.json`), read on the server for the root
 * layout's title template and the shell's brand on the first paint (`(shell)/layout.tsx`). The admin's one read of the
 * instance on its own (architecture rule 3): the name only, read per request (the owner edits the file while the admin runs).
 * No instance folder (a build, a bare `next start`) or an unreadable file is the default name: a name is never a reason not to render.
 */
export function instanceName(): string {
  try {
    return instanceBrand(hubPaths()).name;
  } catch {
    return DEFAULT_BRAND_NAME;
  }
}
