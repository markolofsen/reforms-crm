"use client";

import { Page } from "@hub/ui/product/shell/page";
import { SectionMenu } from "@/components/section-menu";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { AgentTools } from "./agent/agent-tools";
import { ChecksPane } from "./checks/checks-pane";
import { ConnectionsView } from "./connections/connections-view";
import { AppsRow } from "./mac/apps-row";
import { AutostartRow } from "./mac/autostart-row";
import { CoreBlock } from "./mac/core-block";
import { MailPane } from "./mail/mail-pane";
import { MessengerSettings } from "@/features/messengers/settings/settings-view";
import { SendingPane } from "./sending/sending-pane";

/**
 * Settings (P70): what is set rarely and changes how the Hub behaves, one place, grouped by what each pane governs, as on a Mac.
 * Every pane is one page with the section menu (Sending, Checks, Mail, Agent, Connections, This Mac) as its second column
 * (P125 L4), the one door to a pane (P75: the sidebar draws no children), and nothing on a pane is folded. Sending, Checks, Mail and Agent are the
 * address's project's; Connections and This Mac are the instance's and name no project (`routes-and-url-state.md` rule 10).
 */
export function SendingScreen() {
  const { project } = useProjectScope();
  return (
    <SectionMenu section="settings">
      <Page>
      <SendingPane project={project} />
      </Page>
    </SectionMenu>
  );
}

/** Settings ▸ Checks (P75): the safety rules, every one in view, grouped by what it does to Send. */
export function ChecksScreen() {
  const { project } = useProjectScope();
  return (
    <SectionMenu section="settings">
      <Page>
      <ChecksPane project={project} />
      </Page>
    </SectionMenu>
  );
}

/** Settings ▸ Messengers (P125 L5; it was a Messengers tab): the logins, the bot, each linked chat's rules, the send guards. */
export function MessengerSettingsScreen() {
  const { project } = useProjectScope();
  if (!useRoute("settings.messengers")) return null;
  return (
    <SectionMenu section="settings">
      <MessengerSettings project={project} />
    </SectionMenu>
  );
}

/** Settings ▸ Mail: the project's accounts and its filters. */
export function MailSettingsScreen() {
  const { project } = useProjectScope();
  return (
    <SectionMenu section="settings">
      <Page>
      <MailPane project={project} />
      </Page>
    </SectionMenu>
  );
}

/** Settings ▸ Agent: one group per agent CLI (Claude Code, Codex) with its settings, then one Tools table for both (`AgentTools`). */
export function AgentScreen() {
  const { project } = useProjectScope();
  return (
    <SectionMenu section="settings">
      <Page>
      <AgentTools slug={project} />
      </Page>
    </SectionMenu>
  );
}

/** Settings ▸ Connections: the instance's Notion token (the Telegram bot's is on Settings ▸ Messengers, P71 M3). Its address names no project. */
export function ConnectionsScreen() {
  if (!useRoute("settings.connections")) return null;
  return (
    <SectionMenu section="settings">
      <Page>
      <ConnectionsView kinds={["notion"]} />
      </Page>
    </SectionMenu>
  );
}

/** Settings ▸ This Mac: how this install runs on this Mac (start after a restart, P67), the apps its links open in (P131) and its core version (P68). */
export function MacScreen() {
  if (!useRoute("settings.mac")) return null;
  return (
    <SectionMenu section="settings">
      <Page>
      <AutostartRow />
      <AppsRow />
      <CoreBlock />
      </Page>
    </SectionMenu>
  );
}
