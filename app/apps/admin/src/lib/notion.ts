import { NOTION_KIND_LABELS, type NotionKind } from "@hub/config";
import { hrefOf } from "@hub/contract/local";

type Stated = { notionKind: NotionKind | null; notionPageId: string | null; notionUrl: string | null };
export type NotionView = {
  /** `client` or `lead`: which Notion database the page is in. Null for a draft recorded before the kind was stated. */
  kind: NotionKind | null;
  /** Menu label: says what the link opens, so a lead is never mistaken for a client. */
  label: string;
  web: string | null;
  app: string | null;
};

/**
 * What the card says about the client's Notion page. The link is the agent's own url, else built from the page id.
 * `kind: none` is the agent's statement that the client has no page yet; a missing kind is an older record.
 */
export function notionOf(d: Stated): NotionView {
  const web = d.notionUrl ?? (d.notionPageId ? hrefOf("notion.openPage", { pageId: d.notionPageId, app: false }) : null);
  const app = d.notionPageId ? hrefOf("notion.openPage", { pageId: d.notionPageId, app: true }) : null;
  if (d.notionKind === "none" || (!web && d.notionKind !== null)) return { kind: d.notionKind, label: "No Notion page yet", web: null, app: null };
  if (!web) return { kind: null, label: "No Notion profile found", web: null, app: null };
  const kind = d.notionKind === "client" || d.notionKind === "lead" ? d.notionKind : null;
  return { kind, label: kind ? `${NOTION_KIND_LABELS[kind]} page in Notion` : "Notion profile", web, app };
}
