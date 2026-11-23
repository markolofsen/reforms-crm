"use client";

import { ExternalLinkIcon, MailIcon } from "lucide-react";
import { LocalActionButton } from "@/components/local-action";

type ConversationHeaderActionsProps = {
  mailMessageId?: string | null;
  notionPageId?: string | null;
};

/** Consistent navigation actions for the shared Mail and Messenger conversation header. */
export function ConversationHeaderActions({ mailMessageId, notionPageId }: ConversationHeaderActionsProps) {
  if (!mailMessageId && !notionPageId) return null;
  return (
    <div aria-label="Conversation tools" className="flex min-w-0 flex-wrap items-center justify-end gap-1" data-slot="conversation-header-actions" role="group">
      {notionPageId && (
        <LocalActionButton action="notion.openPage" ariaLabel="Open client in Notion" args={{ pageId: notionPageId, app: true }} className="max-sm:size-(--control-s) max-sm:px-0 @max-3xl:size-(--control-s) @max-3xl:px-0" size="s" tooltip={{ content: "Open client in Notion" }} variant="quiet">
          <ExternalLinkIcon aria-hidden="true" />
          <span className="hidden sm:inline @max-3xl:hidden">Notion</span>
        </LocalActionButton>
      )}
      {mailMessageId && (
        <LocalActionButton action="mail.openMessage" ariaLabel="Open client's message in Mail" args={{ messageId: mailMessageId }} className="max-sm:size-(--control-s) max-sm:px-0 @max-3xl:size-(--control-s) @max-3xl:px-0" size="s" tooltip={{ content: "Open client's message in Mail" }} variant="quiet">
          <MailIcon aria-hidden="true" />
          <span className="hidden sm:inline @max-3xl:hidden">Mail</span>
        </LocalActionButton>
      )}
    </div>
  );
}
