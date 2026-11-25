// Brands (P60, doc 16 sections 3 and 7), split by P126 P1. Pure: no file, Mail or database access, so parse.ts and
// @hub/notion can import it, and the hub MCP server, the draft writer and doctor all call the same functions.
export { replyLanguage } from "@hub/contract/language";
export type { ReplyLanguage } from "@hub/contract/language";
export * from "./table";
export * from "./resolve";
export * from "./from";
export * from "./signature";
export * from "./composer";
export * from "./signoff";
export * from "./knowledge-scope";
export * from "./key";
export * from "./booking";
