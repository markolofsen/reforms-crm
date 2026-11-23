import type { LiveService } from "./live";

/** Live panels' context (P50); absent, `GET /api/live` is 404. */
export type LiveContext = { live?: LiveService };
