import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CORE_ROOT } from "@hub/config/paths";
import { githubOwner, initInstance, InitError, type InitDeps } from "./init";
import { pathLeaks, TEXT_FILE, textLeaks, type Leak } from "./leak-guard";

/**
 * P89 (owner, 2026-11-20): PUBLIC starter repositories, one per project kind, that a customer copies with GitHub's "Use this template"
 * (or `gh repo create <name> --private --template <owner>/<starter>`), clones with --recurse-submodules and sets up with ./run.sh setup.
 * They are GENERATED from the core by `hub starters build <out>` at release, never edited by hand, so they cannot drift and cannot carry
 * our data: each is exactly `hub new-instance --kind <kind>` with no install, plus a README preamble, then checked by the leak guard.
 */
export interface Starter { name: string; kind: string; project: string; title: string }

export const STARTERS: readonly Starter[] = [
  { name: "hub-starter-saas", kind: "software-support", project: "my-product", title: "support for a software product" },
  { name: "hub-starter-realty", kind: "sales-pipeline", project: "my-agency", title: "a real-estate sales pipeline" },
  { name: "hub-starter-generic", kind: "generic", project: "my-project", title: "any business that answers clients by mail" },
];

export function starterPreamble(s: Starter, owner: string): string {
  return [
    `> **Starter for ${s.title}** (kind \`${s.kind}\`). Generated from the core by \`hub starters build\`: do not edit this repository, regenerate it.`,
    "> It holds no data. To start your own Hub:",
    ">",
    `> 1. \`gh repo create <you>/hub-<name> --private --template ${owner}/${s.name}\` (or "Use this template" on GitHub, and choose **Private**).`,
    "> 2. `git clone --recurse-submodules <your new repo>` into a local folder (never Google Drive, iCloud or Dropbox).",
    `> 3. \`./run.sh setup\`, then \`./run.sh agent ${s.project}\` and say «настрой проект ${s.project}» (rename the project first with \`./run.sh project rename ${s.project} <slug> --apply\` if you like).`,
    ">",
    "> The whole workflow: `core/@docs/setup/team.md`.",
    "",
    "",
  ].join("\n");
}

const tracked = (dir: string, rel = ""): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (rel === "" && (e.name === ".git" || e.name === "core")) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...tracked(dir, r));
    else out.push(r);
  }
  return out;
};

/** The leak guard over a generated starter (its own files; `core/` is the public core itself). */
export function starterLeaks(dir: string): Leak[] {
  const files = tracked(dir);
  const leaks = pathLeaks(files, "starter");
  for (const f of files) {
    const abs = path.join(dir, f);
    if (!TEXT_FILE.test(f) || statSync(abs).size > 2_000_000) continue;
    leaks.push(...textLeaks(f, readFileSync(abs, "utf8")));
  }
  return leaks;
}

export interface StarterResult { starter: Starter; dir: string; pin: string; publishLine: string; pushLine: string }

/** Generates every starter (or the named ones) under `out`, each a git repo with one commit. A leak fails the build. */
export async function buildStarters(out: string, o: { coreUrl?: string; pin?: string; only?: string[] }, d: InitDeps): Promise<StarterResult[]> {
  const root = path.resolve(out);
  const pick = o.only?.length ? STARTERS.filter((s) => o.only!.includes(s.name) || o.only!.includes(s.kind)) : [...STARTERS];
  if (!pick.length) throw new InitError(`no starter named ${o.only?.join(", ")}; starters: ${STARTERS.map((s) => s.name).join(", ")}`);
  // The same default as new-instance (the origin of the core in use), resolved once so the README names the right owner.
  const coreUrl = o.coreUrl ?? ((await d.run("git", ["-C", d.coreRoot ?? CORE_ROOT, "remote", "get-url", "origin"])).stdout.trim() || undefined);
  const owner = githubOwner(coreUrl ?? "") ?? "<owner>";
  const results: StarterResult[] = [];
  for (const s of pick) {
    const dir = path.join(root, s.name);
    if (existsSync(dir) && readdirSync(dir).length) throw new InitError(`${dir} is not empty: build starters into an empty folder (they are regenerated, never updated in place)`);
    const r = await initInstance({ dir, kind: s.kind, project: s.project, starter: true, install: false, name: s.name, ...(coreUrl ? { coreUrl } : {}), ...(o.pin ? { pin: o.pin } : {}) }, {
      ...d,
      beforeCommit: (home) => {
        const readme = path.join(home, "README.md");
        writeFileSync(readme, starterPreamble(s, owner) + readFileSync(readme, "utf8"));
        const leaks = starterLeaks(home);
        if (leaks.length) throw new InitError(`starter ${s.name} would leak: ${leaks.map((l) => `${l.file} (${l.why})`).join("; ")}`);
      },
    });
    results.push({
      starter: s, dir, pin: r.pin,
      publishLine: `gh repo create ${owner}/${s.name} --public --description "Hub starter: ${s.title}" && gh api -X PATCH repos/${owner}/${s.name} -f is_template=true`,
      pushLine: `git -C ${JSON.stringify(dir)} remote add origin https://github.com/${owner}/${s.name}.git && git -C ${JSON.stringify(dir)} push -u origin main`,
    });
  }
  return results;
}
