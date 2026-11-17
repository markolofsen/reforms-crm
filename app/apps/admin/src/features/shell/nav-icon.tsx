import { ActivityIcon, InboxIcon, PlugIcon, LayoutDashboardIcon, SendIcon, SettingsIcon, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import type { IconKey } from "@/routes/sections";

// The icon keys of `routes/sections.ts`, resolved here (a missing key fails `tsc`) so the route data never imports an icon.
const ICONS: Record<IconKey, LucideIcon> = { overview: LayoutDashboardIcon, inbox: InboxIcon, send: SendIcon, activity: ActivityIcon, settings: SettingsIcon, connections: PlugIcon };

export function NavIcon({ name }: { name: IconKey }) {
  return createElement(ICONS[name], { "aria-hidden": true });
}
