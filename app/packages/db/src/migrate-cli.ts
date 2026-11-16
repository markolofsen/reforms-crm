import { defaultDbPath, openDb } from "./client";

// openDb applies the committed SQL migrations in ./drizzle.
const { close } = openDb();
close();
console.log(`migrations applied: ${defaultDbPath()}`);
