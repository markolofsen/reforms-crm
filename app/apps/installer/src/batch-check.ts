import { judgeSimilarity, measureAgainstSet, pairwise, type Level } from "@hub/projects";
import { readLines, recordsFile } from "@hub/projects/evidence-store";
import type { RecordLine } from "@hub/agent/records";

// `hub batch-check --project X --batch K [--json]` (P28 B5): the one place the skill and the owner look at a batch as a
// set. Reads state/evidence/<slug>/records.jsonl (written by `hub record-draft`), so it works with the server off and
// needs no database column. Until the admin DB carries fingerprints (C1), a batch recorded in a session with no hooks
// (Claude Desktop) has no sketches: its similarity column says so instead of pretending.

export interface BatchRow {
  client: string;
  email: string;
  evidence: RecordLine["evidence"];
  source: RecordLine["source"];
  read: string;
  profile: string;
  facts: number;
  anchors: number;
  maxSim: number | null;
  similarTo: string | null;
  residue: number | null;
  level: Level;
  notes: string[];
}

export interface BatchReport { project: string; batch: string; rows: BatchRow[]; pairs: Array<{ a: string; b: string; sim: number }>; counts: { total: number; ok: number; amber: number; red: number }; red: boolean }

export function batchCheck(root: string, project: string, batch: string): BatchReport {
  const latest = new Map<string, RecordLine>();
  for (const r of readLines<RecordLine>(recordsFile(root, project))) if (r.batchKey === batch) latest.set(r.email, r);
  const recs = [...latest.values()];
  const sketches = recs.filter((r) => r.fp?.length).map((r) => ({ id: r.email, fp: r.fp! }));
  const rows: BatchRow[] = recs.map((r) => {
    const notes = r.warnings.slice();
    let level: Level = r.evidence === "missing" ? "red" : r.evidence === "weak" ? "amber" : "ok";
    let maxSim: number | null = null;
    let similarTo: string | null = null;
    let residue: number | null = null;
    if (r.fp?.length && sketches.length > 1) {
      const m = measureAgainstSet(r.email, sketches);
      maxSim = m.maxSim;
      similarTo = m.similarTo;
      residue = m.residue ?? null;
      const j = judgeSimilarity({ maxSim: m.maxSim, ...(m.residue !== undefined ? { residue: m.residue } : {}) });
      notes.push(...j.reasons.map((x) => `${x}${m.similarTo ? ` (closest ${m.similarTo})` : ""}`));
      if (j.level === "red" || (j.level === "amber" && level === "ok")) level = j.level;
    } else if (!r.fp?.length) notes.push("no reply sketch (no hook ledger for this draft): similarity not measured");
    if (r.source === "claimed") notes.push("counts are claimed, not observed");
    const c = r.context;
    return { client: r.name, email: r.email, evidence: r.evidence, source: r.source, read: c ? `${r.observed?.read ?? c.thread.read}${c.thread.firstContact ? " (first contact)" : ""}` : "-", profile: c ? c.profile.state : "-", facts: c?.facts.queries ?? 0, anchors: c?.anchors.length ?? 0, maxSim, similarTo, residue, level, notes };
  });
  const counts = { total: rows.length, ok: rows.filter((r) => r.level === "ok").length, amber: rows.filter((r) => r.level === "amber").length, red: rows.filter((r) => r.level === "red").length };
  return { project, batch, rows, pairs: pairwise(sketches).slice(0, 5), counts, red: counts.red > 0 };
}

export function batchLines(r: BatchReport): string[] {
  const head = ["#", "client", "evidence", "source", "read", "profile", "facts", "anchors", "max sim", "verdict"];
  const body = r.rows.map((x, i) => [String(i + 1), x.client, x.evidence, x.source, x.read, x.profile, String(x.facts), String(x.anchors), x.maxSim === null ? "-" : x.maxSim.toFixed(2), x.level.toUpperCase()]);
  const w = head.map((h, c) => Math.max(h.length, ...body.map((b) => b[c]!.length)));
  const fmt = (b: string[]) => b.map((x, c) => x.padEnd(w[c]!)).join("  ").trimEnd();
  const out = [`batch ${r.batch} of ${r.project}: ${r.counts.total} draft(s), ${r.counts.ok} ok, ${r.counts.amber} amber, ${r.counts.red} red`, fmt(head), ...body.map(fmt)];
  r.rows.forEach((x, i) => { if (x.notes.length) out.push(`  #${i + 1} ${x.email}: ${x.notes.join("; ")}`); });
  if (r.pairs.length) out.push("closest pairs:", ...r.pairs.map((p) => `  ${p.sim.toFixed(2)}  ${p.a}  <->  ${p.b}`));
  return out;
}
