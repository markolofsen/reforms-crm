import { ActionButton } from "@hub/ui/product/action-button";
import { Page } from "@hub/ui/product/shell/page";
import { AppLink } from "@/components/app-link";
import { EmptyState } from "@/components/state-views";
import { dest } from "@/routes/paths";

/** P103 S2: a client key nobody in this project has (a typo, another instance's address): said, with the way back to Mail. */
export function NoSuchClient() {
  return (
    <Page>
      <EmptyState action={<ActionButton render={<AppLink bare to={dest("mail.list")} />} size="s" variant="secondary">Back to Mail</ActionButton>} title="No such client">
        Nobody in this project has that address.
      </EmptyState>
    </Page>
  );
}
