import { z } from "zod";
import type { SqliteClient } from "@hub/db";
import { DEFAULT_DIRECTION } from "../config";
import { GroupRow, parseRows, type WatchGroup } from "./rows";

const Progress = z.object({ username: z.string(), last_analysis_at: z.string().nullable(), pending: z.number() });

/** A direction's cursor is its last persisted window; polling state belongs to the shared source. */
export function analysisGroups(c: SqliteClient, project: string, direction: string): WatchGroup[] {
  const groups = parseRows(GroupRow, c.prepare("SELECT * FROM groups WHERE project = ? ORDER BY added_at, username").all(project));
  const progress = parseRows(Progress, c.prepare(`SELECT g.username,
    (SELECT s.last_analysis_at FROM analysis_state s WHERE s.project=g.project AND s.group_username=g.username AND s.direction=?) AS last_analysis_at,
    (SELECT count(*) FROM messages m WHERE m.project=g.project AND m.group_username=g.username AND m.message_id >
      max((SELECT coalesce(max(w.last_message_id),0) FROM windows w WHERE w.project=g.project AND w.group_username=g.username AND w.direction=?),
          coalesce((SELECT s.processed_through FROM analysis_state s WHERE s.project=g.project AND s.group_username=g.username AND s.direction=?),0))) AS pending
    FROM groups g WHERE g.project=?`).all(direction, direction, direction, project));
  const byGroup = new Map(progress.map((p) => [p.username, p]));
  return groups.map((g) => ({ ...g, newSinceAnalysis: byGroup.get(g.username)?.pending ?? 0,
    lastAnalysisAt: byGroup.get(g.username)?.last_analysis_at ?? (direction === DEFAULT_DIRECTION ? g.lastAnalysisAt : null) }));
}

export function completeAnalysis(c: SqliteClient, project: string, direction: string, username: string, now: Date, throughMessageId: number): void {
  c.prepare("INSERT INTO analysis_state (project,direction,group_username,last_analysis_at,processed_through) VALUES (?,?,?,?,?) ON CONFLICT (project,direction,group_username) DO UPDATE SET last_analysis_at=excluded.last_analysis_at,processed_through=max(analysis_state.processed_through,excluded.processed_through)")
    .run(project, direction, username, now.toISOString(), throughMessageId);
  // Keep the legacy progress fields readable by older status queries, without changing another direction's progress.
  if (direction === DEFAULT_DIRECTION) c.prepare("UPDATE groups SET new_since_analysis=0,last_analysis_at=? WHERE project=? AND username=?").run(now.toISOString(), project, username);
}
