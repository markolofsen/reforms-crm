import { cn } from "../cn";

/** The monogram of a name: the first letters of its first two words (`Reforms SaaS` -> `RS`, `Hub` -> `H`). */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => [...w][0]?.toUpperCase() ?? "").join("") || "H";
}

/**
 * The instance's brand on top of the sidebar (and the phone's top line): the mark (the configured logo, else a monogram from
 * the name) and the name, 56px high. In the collapsed rail only the mark shows. Same pattern as `@djangocfg/layouts`'
 * PrivateLayout brand header, without the package.
 */
export function BrandHeader({ name, logoSrc, className }: { name: string; logoSrc?: string | null; className?: string }) {
  return (
    <div className={cn("flex h-14 min-w-0 items-center gap-2 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0", className)} data-slot="brand-header">
      {logoSrc ? (
        // A local file served by the API: no image optimiser in front of it, and its size is fixed here.
        <img alt="" className="size-7 shrink-0 rounded-md object-contain" height={28} src={logoSrc} width={28} />
      ) : (
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-md bg-primary font-semibold text-primary-foreground text-xs">
          {monogram(name)}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-heading font-semibold text-sm group-data-[collapsible=icon]:sr-only">{name}</span>
    </div>
  );
}
