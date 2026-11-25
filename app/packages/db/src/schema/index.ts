// The database schema, one file per subject (P126 DB1). This is the one schema object drizzle reads (`drizzle.config.ts`,
// `client.ts`), not a compatibility layer: every table is defined in exactly one file below.
// Every table carries `project`: one database serves several projects (owner decision).
// Timestamps are ISO-8601 UTC text.
export * from "./clients";
export * from "./agent";
export * from "./drafts";
export * from "./mail";
export * from "./sends";
export * from "./projects";
export * from "./knowledge";
export * from "./messengers";
export * from "./llm";
export * from "./follow-ups";
