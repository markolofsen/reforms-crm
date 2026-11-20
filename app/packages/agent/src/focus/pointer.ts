import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { POINTER_TTL_MS, pointerRecord, type PointerRecord } from "@hub/contract/pointer";

// The agent's pointer file (P72, decision 0038): `state/pointer.json`, mode 600, refs and ids only. One writer, the
// `highlight` tool of `hub mcp`; one reader, the server's `GET /api/pointer`. A new pointer replaces the old one; `refs: []`
// is a clear; it is live for 30 s from `at`.

/** `state/pointer.json`, parsed; null when missing, unreadable or of another shape. */
export function readPointerFile(file: string): PointerRecord | null {
  try {
    if (!existsSync(file)) return null;
    const r = pointerRecord.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** The live pointer of the file: null when there is none, it is a clear, or it is older than 30 s. */
export function livePointer(file: string, now: Date = new Date()): (PointerRecord & { expiresAt: string }) | null {
  const p = readPointerFile(file);
  if (!p || p.refs.length === 0) return null;
  const until = Date.parse(p.at) + POINTER_TTL_MS;
  return Number.isFinite(until) && until > now.getTime() ? { ...p, expiresAt: new Date(until).toISOString() } : null;
}

/** Writes a pointer atomically (mode 600) and returns it; a fresh id each time, so the admin draws it once. */
export function writePointer(file: string, o: { project: string; refs: readonly string[]; note: string | null; now?: Date }): PointerRecord {
  const rec: PointerRecord = pointerRecord.parse({ schema: 1, id: randomBytes(8).toString("hex"), project: o.project, refs: [...o.refs], note: o.note, at: (o.now ?? new Date()).toISOString() });
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
  return rec;
}
