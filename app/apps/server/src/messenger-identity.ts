import type { MessengerChatDto, MessengerNotionIdentityDto } from "@hub/contract/messenger-panel";
import type { ClientDirectory } from "./client-directory";

type ClientSource = { id: number; name: string; email: string };
type NotionSource = { notionPageId: string | null; notionUrl: string | null } | null;
type IdentitySource = { project: string | null; directory: Pick<ClientDirectory, "current"> };
type ClientDto = NonNullable<MessengerChatDto["client"]>;

export type MessengerIdentityResolver = ReturnType<typeof createMessengerIdentityResolver>;

export function createMessengerIdentityResolver(source: IdentitySource | undefined) {
  const index = (slug: string): ReadonlyMap<string, string> => {
    if (source?.project !== slug) return new Map();
    return new Map((source.directory.current()?.all ?? []).flatMap((entry) => (entry.email ? [[entry.email.trim().toLowerCase(), entry.key] as const] : [])));
  };

  const resolve = (slug: string, email: string | null, ref: NotionSource): MessengerNotionIdentityDto => {
    const directoryKey = email ? index(slug).get(email.trim().toLowerCase()) ?? null : null;
    const pageId = ref?.notionPageId ?? directoryKey;
    const url = ref?.notionUrl ?? null;
    return {
      state: pageId || url ? "resolved" : source?.project === slug && source.directory.current() ? "unresolved" : "unavailable",
      pageId,
      url,
    };
  };

  const client = (slug: string, value: ClientSource | null, ref: NotionSource): ClientDto | null => {
    if (!value) return null;
    const notion = resolve(slug, value.email, ref);
    return { ...value, notionPageId: notion.pageId, notionUrl: notion.url, notion };
  };

  return { client, index, resolve };
}
