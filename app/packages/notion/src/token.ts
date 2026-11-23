import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HubError } from "@hub/config/errors";
import { hubPaths } from "@hub/config/paths";

/** The hub's one secrets folder, `<home>/state/secrets/` (git-ignored); `HUB_CONFIG_DIR` overrides. The rule lives in `@hub/config/paths`. */
export const secretsDir = (env: NodeJS.ProcessEnv = process.env): string => hubPaths({ env }).secrets;
export const tokenFile = (env: NodeJS.ProcessEnv = process.env): string => join(secretsDir(env), "notion-token");

export class NoTokenError extends HubError {
  constructor(file: string = tokenFile()) {
    super(
      "unavailable",
      "no_token",
      `No Notion token. Set NOTION_TOKEN or put the token alone in ${file} (chmod 600). ` +
        "See app/packages/notion/README.md, section Token.",
    );
    this.name = "NoTokenError";
  }
}

/** NOTION_TOKEN first, then the token file. The value is never logged. */
export async function loadToken(env: NodeJS.ProcessEnv = process.env, file: string = tokenFile(env)): Promise<string> {
  const fromEnv = env.NOTION_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = (await readFile(file, "utf8")).trim();
    if (fromFile) return fromFile;
  } catch {
    // fall through to the error below
  }
  throw new NoTokenError(file);
}
