// Read side of @hub/notion for other packages (import from "@hub/notion"): the reader, the token loader and the counter.
export { createNotionReader, type ReaderOptions } from "./notion";
export { loadToken, NoTokenError, secretsDir, tokenFile } from "./token";
export { contactChannelOf, LEAD_STATUSES, parseLeadDetail, parseLeadPage, renderLeadSummary, summarizeLeads, type Lead, type LeadDetail, type LeadStatus, type LeadSummary } from "./leads";
export { classifyNotionError, countPages, COUNT_PAGE_CAP, COUNT_ROW_CAP, type NotionFailure, type PageCount } from "./count";
export type { NotionReader, PageObject } from "./types";
export { findClientByEmail, findClientPages, findLeadByEmail, type ClientLookup, type LeadLookup } from "./client-lookup";
