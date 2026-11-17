import { openDb } from "./client";
import { createRepos } from "./repos";
import { seed, seedMany } from "./seed";

// `seed-cli` seeds an empty database; `seed-cli --many 120 [project]` adds that many drafted clients to a project (manual viewing of a long list).
const args = process.argv.slice(2);
const at = args.indexOf("--many");
const { db, close } = openDb();
const repos = createRepos(db);
if (at >= 0) {
  const count = Number(args[at + 1]);
  if (!Number.isInteger(count) || count < 1) throw new Error("--many needs a whole number, for example --many 120");
  await seedMany(repos, { project: args[at + 2] ?? "lisbon-realty", count });
  console.log(`added ${count} drafted clients`);
} else {
  const done = await seed(repos);
  console.log(done ? "seeded invented data" : "database already has clients; seed skipped");
}
close();
