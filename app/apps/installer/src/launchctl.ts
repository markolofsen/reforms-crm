import type { Ctx } from "./context";

/** Is a launchd label loaded for this user? Only the `mail.daemon` check asks (mail-mcp runs as a brew service). */
export async function isLoaded(ctx: Ctx, label: string): Promise<boolean> {
  return (await ctx.run("launchctl", ["print", `gui/${ctx.uid}/${label}`])).code === 0;
}
