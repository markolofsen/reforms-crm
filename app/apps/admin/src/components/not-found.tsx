"use client";

import { AppLink } from "@/components/app-link";
import { EmptyState } from "@/components/state-views";
import { usePath } from "@/hooks/use-route";
import { dest } from "@/routes/paths";

/** An address that matches no screen, or a subject id that is not a number. Never another screen in disguise. */
export function NotFound() {
  const path = usePath();
  return (
    <EmptyState title="Page not found">
      <span className="flex flex-col items-start gap-2">
        <span>
          Nothing lives at <code>{path}</code>.
        </span>
        <AppLink to={dest("mail.list")}>Go to Mail</AppLink>
      </span>
    </EmptyState>
  );
}
