import type React from "react";
import { cn } from "@/lib/utils";

/** The one anchor of the admin. Text links get the underline on hover; `bare` leaves the styling to the caller (a Button render target). */
export function Link({ className, bare = false, ...props }: React.ComponentProps<"a"> & { bare?: boolean }): React.ReactElement {
  const external = props.target === "_blank";
  return (
    // eslint-disable-next-line jsx-a11y/anchor-has-content -- the caller passes the children
    <a
      className={cn(!bare && "inline-flex w-fit items-center rounded-sm text-muted-foreground text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11", className)}
      data-slot="link"
      {...props}
      rel={external ? "noreferrer" : props.rel}
    />
  );
}
