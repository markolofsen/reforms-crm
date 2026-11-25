import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOwnFile } from "@hub/db";
import { describe, expect, it } from "vitest";
import { importExperiment } from "../src/store/import";
import { tempStore } from "./support";

// P144 W3: `hub watch import` on an invented corpus shaped like the experiment's `audience.sqlite` (its tables as store.py writes
// them). Nothing here is the experiment's data.
const SCHEMA = `
CREATE TABLE chats (chat_id INTEGER PRIMARY KEY, username TEXT, title TEXT, members INTEGER, kind TEXT, found_by TEXT);
CREATE TABLE messages (chat_id INTEGER, msg_id INTEGER, sender_id INTEGER, sender_username TEXT, sender_name TEXT, date TEXT, text TEXT, PRIMARY KEY (chat_id, msg_id));
CREATE TABLE windows (window_key TEXT PRIMARY KEY, size INTEGER, overlap INTEGER, chat_id INTEGER, first_msg INTEGER, last_msg INTEGER, n_messages INTEGER, tokens INTEGER, cost_usd REAL, topics TEXT, mood TEXT);
CREATE TABLE moments (size INTEGER, overlap INTEGER, chat_id INTEGER, msg_id INTEGER, trigger TEXT, trigger_other TEXT, sender_id INTEGER, sender_username TEXT, reactors TEXT, quote TEXT, thread_context TEXT, intensity INTEGER, fit_reason TEXT, window_key TEXT, PRIMARY KEY (size, overlap, chat_id, msg_id, trigger));
`;

function corpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "exp-"));
  mkdirSync(join(dir, "m"));
  writeFileSync(join(dir, "m", "0001_experiment.sql"), SCHEMA);
  const h = openOwnFile(join(dir, "audience.sqlite"), { migrationsFolder: join(dir, "m"), label: "test" });
  const c = h.client;
  c.prepare("INSERT INTO chats VALUES (1, 'Garden_Talk', 'Garden talk', 100, 'megagroup', 'test'), (2, NULL, 'private one', 5, 'group', 'test')").run();
  const msg = c.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, 'Name', ?, ?)");
  for (let k = 1; k <= 12; k++) msg.run(1, k, 40 + (k % 3), k % 3 === 0 ? null : `u${k % 3}`, `2026-11-20T10:${String(k).padStart(2, "0")}:00+00:00`, k === 12 ? "" : `text ${k}`);
  msg.run(2, 1, 9, "hidden", "2026-11-20T10:00:00+00:00", "not public");
  c.prepare("INSERT INTO windows VALUES ('w100o20:1:1-12', 100, 20, 1, 1, 12, 12, 900, 0.0002, '[\"mowers\"]', 'calm'), ('w50o10:1:1-12', 50, 10, 1, 1, 12, 12, 900, 0.0001, '[]', 'x')").run();
  c.prepare("INSERT INTO moments VALUES (100, 20, 1, 4, 'broken_tool', '', 41, 'u1', '[\"@u2\"]', 'it broke', 'mowers', 4, 'fits', 'w100o20:1:1-12'), (50, 10, 1, 5, 'other', 'x', 42, 'u2', '[]', 'q', '', 1, '', 'w50o10:1:1-12')").run();
  h.close();
  return join(dir, "audience.sqlite");
}

describe("hub watch import", () => {
  it("loads public groups, their messages, and the 100/20 windows and moments; twice is the same", () => {
    const file = corpus();
    const store = tempStore();
    const now = new Date("2026-11-21T00:00:00Z");
    expect(importExperiment(file, store, { taskVersion: 1, now })).toEqual({ groups: 1, messages: 11, windows: 1, moments: 1 });
    expect(store.groups().map((g) => [g.username, g.title, g.access, g.lastMessageId, g.newSinceAnalysis])).toEqual([["garden_talk", "Garden talk", "open", 11, 0]]);
    expect(store.moments({})).toMatchObject([{ groupUsername: "garden_talk", messageId: 4, authorHandle: "@u1", reactorHandles: ["@u2"], at: "2026-11-20T10:04:00.000Z", intensity: 4 }]);
    expect(store.topics("2026-11-01")).toEqual([{ topic: "mowers", windows: 1 }]);
    expect(store.windowsLastMessage("garden_talk")).toBe(12);
    expect(importExperiment(file, store, { taskVersion: 1, now })).toEqual({ groups: 1, messages: 0, windows: 0, moments: 0 });
  });
});
