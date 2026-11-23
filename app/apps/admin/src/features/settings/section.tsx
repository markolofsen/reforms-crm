"use client";

import { Page } from "@hub/ui/product/page";
import { SubNav } from "@/components/sub-nav";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { AgentTools } from "./agent/agent-tools";
import { ChecksPane } from "./checks/checks-pane";
import { ConnectionsView } from "./connections/connections-view";
import { AppsRow } from "./mac/apps-row";
import { AutostartRow } from "./mac/autostart-row";
import { CoreBlock } from "./mac/core-block";
import { MailPane } from "./mail/mail-pane";
import { SendingPane } from "./sending/sending-pane";

/**
 * Settings (P70): what is set rarely and changes how the Hub behaves, one place, grouped by what each pane governs, as on a Mac.
 * Every pane is one page with the sub-nav (Sending, Checks, Mail, Agent, Connections, This Mac) in its header line, the one door
 * to a pane (P75: the sidebar draws no children), and nothing on a pane is folded. Sending, Checks, Mail and Agent are the
 * address's project's; Connections and This Mac are the instance's and name no project (`routes-and-url-state.md` rule 10).
 */
export function SendingScreen() {
  const { project } = useProjectScope();
  return (
    <Page nav={<SubNav section="settings" />}>
      <SendingPane project={project} />
    </Page>
  );
}

/** Settings ▸ Checks (P75): the safety rules, every one in view, grouped by what it does to Send. */
export function ChecksScreen() {
  const { project } = useProjectScope();
  return (
    <Page nav={<SubNav section="settings" />}>
      <ChecksPane project={project} />
    </Page>
  );
}

/** Settings ▸ Mail: the project's accounts and its filters. */
export function MailScreen() {
  const { project } = useProjectScope();
  return (
    <Page nav={<SubNav section="settings" />}>
      <MailPane project={project} />
    </Page>
  );
}

/** Settings ▸ Agent: one group per agent CLI (Claude Code, Codex) with its settings, then one Tools table for both (`AgentTools`). */
export function AgentScreen() {
  const { project } = useProjectScope();
  return (
    <Page nav={<SubNav section="settings" />}>
      <AgentTools slug={project} />
    </Page>
  );
}

/** Settings ▸ Connections: the instance's Notion token (the Telegram bot's is on Messengers ▸ Settings, P71 M3). Its address names no project. */
export function ConnectionsScreen() {
  if (!useRoute("settings.connections")) return null;
  return (
    <Page nav={<SubNav section="settings" />}>
      <ConnectionsView kinds={["notion"]} />
    </Page>
  );
}

/** Settings ▸ This Mac: how this install runs on this Mac (start after a restart, P67), the apps its links open in (P131) and its core version (P68). */
export function MacScreen() {
  if (!useRoute("settings.mac")) return null;
  return (
    <Page nav={<SubNav section="settings" />}>
      <AutostartRow />
      <AppsRow />
      <CoreBlock />
    </Page>
  );
}
