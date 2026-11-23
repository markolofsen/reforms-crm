// P126 C1: `hub mail-filters …` (alias `filters`), registered by the installer; the work is @hub/mail-filters/commands.
import type { Command } from "commander";
import { runCheck, runColors, runExportApi, runExportXml, runPropose, type MailFiltersOptions } from "@hub/mail-filters/commands";
import { UnsafeRulesError } from "@hub/mail-filters";

export function registerMailFiltersCommands(program: Command, o: MailFiltersOptions = {}): Command {
  return program
    .command("mail-filters")
    .description("Gmail filters for one project's mail: propose rules from a sender sample, check the rules file, export mailFilters.xml or an API request list. Files only.")
    .argument("<slug>", "project")
    .argument("<action>", "propose | check | colors | export-xml | export-api")
    .option("--sample <file>", "propose: JSON array of {from, subject, listId, hasUnsubscribe, bulk}")
    .option("--apply", "propose: write the confident proposals into mail-filters.md")
    .option("--accept <groups...>", "propose --apply: uncertain groups (domain or address) the owner confirmed")
    .option("--out <file>", "export: target file (default: next to project.md)")
    .action((slug: string, action: string, opt: { sample?: string; apply?: boolean; accept?: string[]; out?: string }) => {
      try {
        if (action === "colors") process.exitCode = runColors(slug, o);
        else if (action === "check") process.exitCode = runCheck(slug, o);
        else if (action === "export-xml") process.exitCode = runExportXml(slug, { ...o, ...(opt.out ? { to: opt.out } : {}) });
        else if (action === "export-api") process.exitCode = runExportApi(slug, { ...o, ...(opt.out ? { to: opt.out } : {}) });
        else if (action === "propose") {
          if (!opt.sample) throw new Error("propose needs --sample <file>");
          process.exitCode = runPropose(slug, { ...o, sample: opt.sample, ...(opt.apply ? { apply: true } : {}), ...(opt.accept ? { accept: opt.accept } : {}) });
        } else throw new Error(`unknown action "${action}" (propose, check, colors, export-xml, export-api)`);
      } catch (e) {
        (o.out ?? console.error)(`${e instanceof UnsafeRulesError ? "refused" : "error"}: ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });
}
