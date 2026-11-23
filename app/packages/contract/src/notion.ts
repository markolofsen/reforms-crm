import { z } from "zod";

export const NOTION_IDENTITY_STATES = ["resolved", "unresolved", "unavailable"] as const;

/** A contact's Notion identity, shared by Mail and Messenger surfaces. */
export const notionIdentityDto = z.strictObject({
  /** `resolved` has a page id or URL; `unresolved` means a lookup found no page; `unavailable` means no lookup was available. */
  state: z.enum(NOTION_IDENTITY_STATES),
  pageId: z.string().nullable(),
  url: z.string().nullable(),
});
export type NotionIdentityDto = z.infer<typeof notionIdentityDto>;
