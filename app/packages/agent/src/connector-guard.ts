import type { HubPaths } from "@hub/config/paths";
import { connectorKindOf, KINDS, writeConnectorAccount, type AttachedConnector } from "./connectors";
import type { NotionScope } from "./notion-scope";

// P82: the Notion scope rules live beside these (`notion-scope.ts`); the guard imports them from here, the package's guard door.
export { collectionIds, hexId, notionNote, notionScopeOf, notionViolations, type NotionRead, type NotionScope } from "./notion-scope";
// P154: vendor guidance in a third-party MCP reply, removed (or, on an error reply, answered with a note) by the post hooks.
export { cleanToolReply, GUIDANCE_KEYS, guidanceInError, guidanceNote, serverLabel, vendorTool, type CleanedReply } from "./tool-guidance";

// P62 K3: the guard's rules for connector calls. These always block, whatever HUB_GUARD says: a connector write leaves the Mac
// (an invitation, a shared file), and a tool off the allowlist is one the hub never reviewed. The deny rules name the known
// writes; this is the belt for a renamed or new tool, and the only check of a call's arguments (guests on a hold, a folder).

export interface ConnectorScope {
  attached: readonly AttachedConnector[];
  /** `calendar.id` of project.md: where holds go (null: the connector's primary calendar). */
  calendarId: string | null;
  /** `drive.folder` of project.md: a search's query must name one (empty: no check). */
  driveFolders: readonly string[];
  /** P82: the project's Notion databases; absent or empty: no Notion check (unbound, or setup not done). */
  notion?: NotionScope;
}

const CALL = /^mcp__((?:gcal|gdrive)-[a-z0-9][a-z0-9-]*)__(.+)$/;

const nonEmpty = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null && v !== false);

/** Why a connector call is refused; empty when it may run, or when the tool is not a connector's. */
export function connectorViolations(name: string, input: unknown, s: ConnectorScope): string[] {
  const m = CALL.exec(name);
  if (!m) return [];
  const [, server, tool] = m as unknown as [string, string, string];
  const kind = connectorKindOf(server);
  const c = s.attached.find((a) => a.name === server);
  if (!kind || !c) return [`${server} is not a connector of this project (project.md lists the connectors a session may use)`];
  const def = KINDS[kind];
  if (!def.allowed.includes(tool)) return [`${server}.${tool} is not on the ${def.label} allowlist (read${def.holds.length ? " and holds" : ""} only; see @docs/core/26-capabilities.md)`];
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: string[] = [];
  if (def.holds.includes(tool)) {
    // A hold is the owner's own reminder: no guest, no Meet link, no mail (doc 19 rule 1). An invitation is sent by him, by hand.
    for (const k of ["attendees", "attendeeEmails", "addGoogleMeetUrl", "googleMeetUrl", "guestPermissions"]) if (nonEmpty(i[k])) out.push(`${server}.${tool} with ${k}: a hold has no guests and sends no invitation`);
    if (typeof i.notificationLevel === "string" && i.notificationLevel !== "NONE") out.push(`${server}.${tool} with notificationLevel ${i.notificationLevel}: a hold sends no mail (use NONE or leave it out)`);
    // Holds go to calendar.id, else the connector's primary calendar ("primary", or its id: the account).
    const target = typeof i.calendarId === "string" && i.calendarId.trim() ? i.calendarId.trim().toLowerCase() : "primary";
    const primary = new Set(["primary", ...(c.account ? [c.account.account] : [])]);
    const want = s.calendarId?.trim().toLowerCase() || null;
    const ok = want ? target === want || (primary.has(target) && primary.has(want)) : primary.has(target);
    if (!ok) out.push(`${server}.${tool} on calendar ${target}: holds go to ${want ?? "the connector's primary calendar"} (calendar.id)`);
  }
  if (kind === "drive" && tool === "search_files" && s.driveFolders.length) {
    const q = JSON.stringify(i);
    if (!s.driveFolders.some((f) => q.includes(f))) out.push(`${server}.search_files outside this project's Drive folders (drive.folder): add '<folder id>' in parents to the query`);
  }
  return [...new Set(out)];
}

/** The calendar ids of a `list_calendars` answer with `primary: true` (the account it is signed in to), from JSON text blocks or a plain object. */
export function primaryCalendarOf(response: unknown): string | null {
  const seen: unknown[] = [];
  const walk = (v: unknown, depth: number): string | null => {
    if (depth > 8 || v === null || typeof v !== "object" || seen.includes(v)) {
      if (typeof v === "string" && depth <= 8 && /^\s*[[{]/.test(v)) { try { return walk(JSON.parse(v), depth + 1); } catch { return null; } }
      return null;
    }
    seen.push(v);
    if (Array.isArray(v)) { for (const e of v) { const r = walk(e, depth + 1); if (r) return r; } return null; }
    const o = v as Record<string, unknown>;
    // An email shape only: the id goes into state and from there into the next session's capabilities line.
    if (o.primary === true && typeof o.id === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.id) && o.id.length <= 254) return o.id;
    for (const k of Object.keys(o)) { const r = walk(o[k], depth + 1); if (r) return r; }
    return null;
  };
  return walk(response, 0);
}

/**
 * The guard's post hook: a session's `list_calendars` on an attached calendar connector records the account it is signed in to
 * (`how: session`), so doctor and the capabilities line name it without a call of the hub's own (it holds no login). Never throws.
 */
export function recordConnectorRead(paths: HubPaths, attached: readonly AttachedConnector[], name: string, response: unknown): string | null {
  try {
    const m = CALL.exec(name);
    if (!m || m[2] !== "list_calendars") return null;
    const c = attached.find((a) => a.name === m[1] && a.kind === "calendar");
    if (!c) return null;
    const id = primaryCalendarOf(response);
    if (id && (c.account?.account !== id.toLowerCase() || c.account.how !== "session")) writeConnectorAccount(paths, c.name, id, "session");
    return id;
  } catch { return null; }
}
