import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";
import { MARK_LABELS, type Mark } from "@hub/config";
import { ActionButton } from "@/components/action-button";
import { Menu, MenuCheckboxItem, MenuGroup, MenuGroupLabel, MenuItem, MenuLinkItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Popover, PopoverClose, PopoverDescription, PopoverPopup, PopoverTitle } from "@/components/ui/popover";
import { toastManager } from "@/components/ui/toast";
import { notionOf } from "@/lib/notion";
import type { ReviewActions } from "../use-review-actions";
import type { ReviewDraft } from "../source";

/**
 * The only place a client flag can change (never a control in a list row, never next to Send). Follow up and VIP apply
 * at once with an Undo toast; "Do not contact..." asks first, in a popover anchored to the button, and Undo follows.
 */
export function ClientMenu({ d, actions }: { d: ReviewDraft; actions: ReviewActions }) {
  const [confirm, setConfirm] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const marks = d.client.marks;
  const first = d.client.name.split(" ")[0] ?? d.client.name;
  const change = (mark: Mark, on: boolean) => {
    const next = on ? [...marks, mark] : marks.filter((m) => m !== mark);
    actions.setMarks(d.clientId, next);
    toastManager.add({
      title: on ? `Marked ${MARK_LABELS[mark]}` : `${MARK_LABELS[mark]} turned off`,
      type: "success",
      actionProps: { children: "Undo", onClick: () => actions.setMarks(d.clientId, marks) },
    });
  };
  const notion = notionOf(d);
  const blocked = marks.includes("do_not_contact");
  return (
    <>
      <Menu>
        <MenuTrigger render={<ActionButton ref={anchor} size="s" variant="quiet" />}>
          Client
          <ChevronDownIcon aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuGroup>
            <MenuGroupLabel>
              {d.client.name}
              <span className="block font-normal text-muted-foreground">{d.client.email}</span>
            </MenuGroupLabel>
          </MenuGroup>
          {notion.web ? (
            <MenuLinkItem href={notion.web} rel="noopener noreferrer" target="_blank">
              {notion.label}
              <ExternalLinkIcon aria-hidden="true" className="ms-auto" />
            </MenuLinkItem>
          ) : (
            <MenuItem disabled>{notion.label}</MenuItem>
          )}
          {notion.app && (
            <MenuLinkItem href={notion.app}>
              Open in the Notion app
              <ExternalLinkIcon aria-hidden="true" className="ms-auto" />
            </MenuLinkItem>
          )}
          <MenuCheckboxItem checked={marks.includes("follow_up")} disabled={actions.pending} onCheckedChange={(on) => change("follow_up", on)}>
            {MARK_LABELS.follow_up}
          </MenuCheckboxItem>
          <MenuCheckboxItem checked={marks.includes("vip")} disabled={actions.pending} onCheckedChange={(on) => change("vip", on)}>
            {MARK_LABELS.vip}
          </MenuCheckboxItem>
          <MenuSeparator />
          <MenuItem disabled={actions.pending} onClick={() => (blocked ? change("do_not_contact", false) : setConfirm(true))} variant="destructive">
            {blocked ? "Allow contact again" : "Do not contact..."}
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Popover onOpenChange={setConfirm} open={confirm}>
        <PopoverPopup align="end" anchor={anchor}>
          <PopoverTitle>Do not contact {first}?</PopoverTitle>
          <PopoverDescription>{first} is left out of every batch and every draft for them is flagged. You can turn this off here.</PopoverDescription>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <PopoverClose render={<ActionButton size="s" variant="quiet" />}>Cancel</PopoverClose>
            <ActionButton
              onClick={() => {
                setConfirm(false);
                change("do_not_contact", true);
              }}
              size="s"
              variant="danger"
            >
              Mark do not contact
            </ActionButton>
          </div>
        </PopoverPopup>
      </Popover>
    </>
  );
}
