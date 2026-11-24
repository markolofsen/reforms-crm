"use client";

import { ExternalLinkIcon, MailIcon, MessageCircleIcon } from "lucide-react";
import { notionPageDestination, telegramDestination, whatsappDestination, type ContactLinksDto, type Destination } from "@hub/contract/local";
import { LocalActionButton } from "@/components/local-action";
import { OpenLinkButton } from "@/components/links/open-link";
import { ClientMapButton, type MapSubject } from "./client-map";

type ConversationHeaderActionsProps = {
  mailMessageId?: string | null;
  notionPageId?: string | null;
  /** P131 O5: the chat's or the Notion card's Telegram and WhatsApp; a button each when one is known (never prefilled). */
  contact?: ContactLinksDto | null;
  /** P135: the client whose map the Map button opens; none for a chat linked to no client. */
  map?: MapSubject | null;
};

const COMPACT = "max-sm:size-(--control-s) max-sm:px-0 @max-3xl:size-(--control-s) @max-3xl:px-0";
const SHORT = "hidden sm:inline @max-3xl:hidden";

/** The two chat apps of a contact: Telegram by username (else phone, app only), WhatsApp by number. */
export function chatDestinations(contact: ContactLinksDto | null | undefined): { telegram: Destination | null; whatsapp: Destination | null } {
  return {
    telegram: contact ? telegramDestination({ username: contact.telegramUsername, phone: contact.telegramPhone }) : null,
    whatsapp: contact ? whatsappDestination(contact.whatsappPhone) : null,
  };
}

/** Consistent navigation actions for the shared Mail and Messenger conversation header. */
export function ConversationHeaderActions({ mailMessageId, notionPageId, contact, map }: ConversationHeaderActionsProps) {
  const notion = notionPageDestination(notionPageId);
  const chats = chatDestinations(contact);
  if (!mailMessageId && !notion && !chats.telegram && !chats.whatsapp && !map) return null;
  return (
    <div aria-label="Conversation tools" className="flex min-w-0 flex-wrap items-center justify-end gap-1" data-slot="conversation-header-actions" role="group">
      {map && <ClientMapButton className={COMPACT} short={SHORT} subject={map} />}
      {notion && (
        <OpenLinkButton ariaLabel={(l) => (l.inApp ? "Open client in Notion" : "Open client's Notion page in browser")} className={COMPACT} to={notion}>
          {() => (
            <>
              <ExternalLinkIcon aria-hidden="true" />
              <span className={SHORT}>Notion</span>
            </>
          )}
        </OpenLinkButton>
      )}
      {chats.telegram && (
        <OpenLinkButton ariaLabel={(l) => l.label} className={COMPACT} to={chats.telegram}>
          {() => (
            <>
              <MessageCircleIcon aria-hidden="true" />
              <span className={SHORT}>Telegram</span>
            </>
          )}
        </OpenLinkButton>
      )}
      {chats.whatsapp && (
        <OpenLinkButton ariaLabel={(l) => l.label} className={COMPACT} to={chats.whatsapp}>
          {() => (
            <>
              <MessageCircleIcon aria-hidden="true" />
              <span className={SHORT}>WhatsApp</span>
            </>
          )}
        </OpenLinkButton>
      )}
      {mailMessageId && (
        <LocalActionButton action="mail.openMessage" ariaLabel="Open client's message in Mail" args={{ messageId: mailMessageId }} className={COMPACT} size="s" tooltip={{ content: "Open client's message in Mail" }} variant="quiet">
          <MailIcon aria-hidden="true" />
          <span className={SHORT}>Mail</span>
        </LocalActionButton>
      )}
    </div>
  );
}
