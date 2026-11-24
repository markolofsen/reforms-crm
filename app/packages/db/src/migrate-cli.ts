import { defaultDbPath, openDb } from "./client";

// openDb applies the committed SQL migrations in ./drizzle.
const { close } = openDb(undefined, { migrate: true });
close();
console.log(`migrations applied: ${defaultDbPath()}`);
