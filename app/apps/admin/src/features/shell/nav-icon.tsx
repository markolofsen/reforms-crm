import { ActivityIcon, InboxIcon, PlugIcon, LayoutDashboardIcon, SendIcon, SettingsIcon, type LucideIcon } from "lucide-react";
import { createElement } from "react";

// The icon keys of `routes/sections.ts`, resolved here so the route data never imports an icon.
const ICONS: Record<string, LucideIcon> = { overview: LayoutDashboardIcon, inbox: InboxIcon, send: SendIcon, activity: ActivityIcon, settings: SettingsIcon, connections: PlugIcon };

export function NavIcon({ name }: { name: string }) {
  return createElement(ICONS[name] ?? InboxIcon, { "aria-hidden": true });
}
