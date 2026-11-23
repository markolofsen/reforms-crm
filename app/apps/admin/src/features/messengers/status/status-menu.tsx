import { ChevronDownIcon, EllipsisIcon } from "lucide-react";
import { Menu, MenuItem, MenuLinkItem, MenuPopup, MenuSeparator, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import type { ContactLinksDto } from "@hub/contract/local";
import { AppLink } from "@/components/app-link";
import { chatDestinations } from "@/components/conversation/header-actions";
import { OpenLinkItem } from "@/components/links/open-link";
import { dest } from "@/routes/paths";

/** What the menu can ask of its row: the row decides what each does (a search box, a confirmation, a move). */
export type StatusAction = "change" | "unlink" | "hide-linked" | "link" | "create" | "hide" | "unhide";

/** The three states of a chat (P102): the menu's items are the moves that state allows, and only those. */
export type StatusState = { state: "linked"; client: string } | { state: "unlinked"; canCreate: boolean } | { state: "hidden"; canLink: boolean };

/**
 * P102 S3: the one state menu of a chat row, the only place a chat changes state, so a row has one control for it instead of a
 * button per move. A linked row shows the client name: Change client (the chat and its messages go to another client), Unlink (deletes), Hide as not a
 * client, and the rules; Not linked: Link to a client, Create client, Hide; Hidden: Link to a client (a hidden chat can be linked),
 * Unhide. A search opens in the row; an item that deletes opens the review dialog (P105, `ui-specifications.md` rules 5d and 5f).
 */
// Compact is the icon-only trigger, named "Chat actions for <name>"; the full one is named by its content, "Status of <name>: Not linked",
// so the name always holds the visible state (WCAG 2.5.3).
export function StatusMenu({ s, name, disabled, onAction, compact = false, contact = null }: { s: StatusState; name: string; disabled: boolean; onAction: (a: StatusAction) => void; compact?: boolean; /** P131 O5: Open in Telegram / WhatsApp, linked chats only. */ contact?: ContactLinksDto | null }) {
  const chats = chatDestinations(contact);
  const label = s.state === "linked" ? s.client : s.state === "unlinked" ? "Not linked" : "Hidden";
  const tooltip = compact ? `Chat actions for ${name}` : undefined;
  const item = (a: StatusAction, text: string, destructive = false) => (
    <MenuItem disabled={disabled} onClick={() => onAction(a)} variant={destructive ? "destructive" : "default"}>
      {text}
    </MenuItem>
  );
  return (
    <Menu>
      <MenuTrigger render={<ActionButton aria-label={compact ? `Chat actions for ${name}` : undefined} className={compact ? "shrink-0" : "max-w-full"} icon={compact} size="s" tooltip={tooltip} variant="quiet" />}>
        {compact ? <EllipsisIcon aria-hidden="true" /> : <><span className="sr-only">Status of {name}: </span><span className="truncate">{label}</span><ChevronDownIcon aria-hidden="true" /></>}
      </MenuTrigger>
      <MenuPopup align="start">
        {s.state === "linked" && (
          <>
            <OpenLinkItem to={chats.telegram} />
            <OpenLinkItem to={chats.whatsapp} />
            {item("change", "Change client…")}
            <MenuLinkItem render={<AppLink to={dest("messengers.settings")} />}>Rules of this chat</MenuLinkItem>
            <MenuSeparator />
            {item("hide-linked", "Hide: not a client…", true)}
            {item("unlink", "Unlink…", true)}
          </>
        )}
        {s.state === "unlinked" && (
          <>
            {item("link", "Link to a client…")}
            {s.canCreate && item("create", "Create client…")}
            <MenuSeparator />
            {item("hide", "Hide: not a client")}
          </>
        )}
        {s.state === "hidden" && (
          <>
            {s.canLink ? item("link", "Link to a client…") : <MenuItem disabled>Link to a client (its account is not connected)</MenuItem>}
            <MenuSeparator />
            {item("unhide", "Unhide")}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}
