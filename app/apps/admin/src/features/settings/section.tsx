"use client";

import { Page } from "@hub/ui/product/page";
import { SubNav } from "@/components/sub-nav";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { AgentGroup } from "./agent/agent-group";
import { AgentTools } from "./agent/agent-tools";
import { Connectors } from "./agent/connectors";
import { SettingsGroup } from "./group";
import { ConnectionsView } from "./connections/connections-view";
import { AutostartRow } from "./mac/autostart-row";
import { CoreBlock } from "./mac/core-block";
import { MailPane } from "./mail/mail-pane";
import { SendingPane } from "./sending/sending-pane";

/**
 * Settings (P70): what is set rarely and changes how the Hub behaves, one place, grouped by what each pane governs, as on a Mac.
 * Every pane is one page with the sub-nav (Sending, Mail, Agent, Connections, This Mac) in its header line. Sending, Mail and
 * Agent are the address's project's; Connections and This Mac are the instance's and name no project (`routes-and-url-state.md`
 * rule 10).
 */
export function SendingScreen() {
  const { project } = useProjectScope();
  return (
    <Page nav={<SubNav section="settings" />}>
      <SendingPane project={project} />
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

/**
 * Settings ▸ Agent (P63's Agents page): how this project's sessions start (P55: the model and the advisor), what they reach beyond
 * mail and Notion (P62: the attached connectors), then whether they can work (the checks of both CLIs).
 */
export function AgentScreen() {
  const { project } = useProjectScope();
  return (
    <Page nav={<SubNav section="settings" />}>
      <AgentGroup project={project} />
      <Connectors slug={project} />
      <SettingsGroup id="agent-checks" title="Checks">
        <AgentTools slug={project} />
      </SettingsGroup>
    </Page>
  );
}

/** Settings ▸ Connections: the instance's Notion token and Telegram bot. Its address names no project. */
export function ConnectionsScreen() {
  const route = useRoute();
  if (route.route !== "settings.connections") return null;
  return (
    <Page nav={<SubNav section="settings" />}>
      <ConnectionsView />
    </Page>
  );
}

/** Settings ▸ This Mac: how this install runs on this Mac (start after a restart, P67) and its core version (P68). */
export function MacScreen() {
  const route = useRoute();
  if (route.route !== "settings.mac") return null;
  return (
    <Page nav={<SubNav section="settings" />}>
      <AutostartRow />
      <CoreBlock />
    </Page>
  );
}
