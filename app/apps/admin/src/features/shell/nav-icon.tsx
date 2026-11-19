import { ActivityIcon, BookOpenIcon, BotIcon, CircleHelpIcon, InboxIcon, LaptopIcon, LayoutDashboardIcon, MailIcon, PlugIcon, SettingsIcon, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import type { IconKey } from "@/routes/sections";

// The icon keys of `routes/sections.ts`, resolved here (a missing key fails `tsc`) so the route data never imports an icon.
const ICONS: Record<IconKey, LucideIcon> = {
  overview: LayoutDashboardIcon,
  inbox: InboxIcon,
  activity: ActivityIcon,
  settings: SettingsIcon,
  knowledge: BookOpenIcon,
  mail: MailIcon,
  mac: LaptopIcon,
  agents: BotIcon,
  connections: PlugIcon,
  help: CircleHelpIcon,
};

export function NavIcon({ name }: { name: IconKey }) {
  return createElement(ICONS[name], { "aria-hidden": true });
}
