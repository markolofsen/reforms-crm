import { openDb } from "./client";
import { createRepos } from "./repos";
import { seed } from "./seed";

const { db, close } = openDb();
const done = await seed(createRepos(db));
console.log(done ? "seeded invented data" : "database already has clients; seed skipped");
close();
