import { NOTION_KIND_LABELS, type NotionKind } from "@hub/config";
import type { NotionIdentityDto } from "@hub/contract/notion";
import { destinationOf, hrefOf } from "@hub/contract/local";

type Stated = { notionKind: NotionKind | null; notionPageId: string | null; notionUrl: string | null };

export type NotionIndicatorState = "connected" | "not_found" | "unavailable";

export function notionIndicatorState(identity: Pick<NotionIdentityDto, "state">): NotionIndicatorState {
  return identity.state === "resolved" ? "connected" : identity.state === "unresolved" ? "not_found" : "unavailable";
}

export function notionIdentityLine(identity: Pick<NotionIdentityDto, "state">, name: string): string {
  const state = notionIndicatorState(identity);
  return `${state === "connected" ? "Notion" : state === "not_found" ? "Notion not found" : "Notion unavailable"} · ${name}`;
}

export const notionPageIdOf = (url: string | null): string | null => (url ? (/([0-9a-f]{32})(?:\?|$)/.exec(url.replace(/-/g, ""))?.[1] ?? null) : null);

export type NotionView = {
  /** `client` or `lead`: which Notion database the page is in. Null for a draft recorded before the kind was stated. */
  kind: NotionKind | null;
  /** Menu label: says what the link opens, so a lead is never mistaken for a client. */
  label: string;
  /** The page's web link (P131: whether the app opens it is decided at render by `useOpenLink`). */
  web: string | null;
};

/**
 * What the card says about the client's Notion page. The link is the agent's own url, else built from the page id.
 * `kind: none` is the agent's statement that the client has no page yet; a missing kind is an older record.
 */
export function notionOf(d: Stated): NotionView {
  // The agent's own url when the table knows it (a slug, a view, notion.site), else the page by id.
  const stated = d.notionUrl ? (destinationOf(d.notionUrl)?.web ?? null) : null;
  const web = stated ?? (d.notionPageId ? hrefOf("notion.openPage", { pageId: d.notionPageId }) : null);
  if (d.notionKind === "none" || (!web && d.notionKind !== null)) return { kind: d.notionKind, label: "No Notion page yet", web: null };
  if (!web) return { kind: null, label: "No Notion profile found", web: null };
  const kind = d.notionKind === "client" || d.notionKind === "lead" ? d.notionKind : null;
  return { kind, label: kind ? `${NOTION_KIND_LABELS[kind]} page in Notion` : "Notion profile", web };
}
