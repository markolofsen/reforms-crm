// The line scan of project.md: fences, the `# ` title, the `## ` sections and the rows of a section's table. Pure.

export interface Section {
  /** Lower-cased heading text. */
  name: string;
  /** Index into the line array of the `## ` heading. */
  start: number;
  /** Index of the first line after the section. */
  end: number;
}

export interface Scan {
  title: string | null;
  titleLine: number;
  /** Lines of the fence-free scan: index -> true when inside a fenced block. */
  fenced: boolean[];
  sections: Section[];
}

/** One pass over the lines (without terminators): fences, the `# ` title and the `## ` sections. */
export function scan(lines: string[]): Scan {
  const fenced: boolean[] = new Array<boolean>(lines.length).fill(false);
  const sections: Section[] = [];
  let title: string | null = null;
  let titleLine = -1;
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced[i] = true;
      fence = !fence;
      return;
    }
    if (fence) {
      fenced[i] = true;
      return;
    }
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2?.[1]) {
      const last = sections[sections.length - 1];
      if (last) last.end = i;
      sections.push({ name: h2[1].toLowerCase(), start: i, end: lines.length });
      return;
    }
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1?.[1] && title === null && sections.length === 0) {
      title = h1[1];
      titleLine = i;
    }
  });
  return { title, titleLine, fenced, sections };
}

export const splitLines = (text: string): string[] => text.split(/\r?\n/);

export function splitRow(line: string): string[] {
  const t = line.trim();
  const inner = t.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

const isSeparatorRow = (cells: string[]): boolean => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));

export interface Table {
  header: string[] | null;
  headerIdx: number;
  rows: Array<{ cells: string[]; idx: number }>;
  lastIdx: number;
}

/** The table rows of a section: header cells and the data rows with their line index. */
export function tableOf(lines: string[], fenced: boolean[], s: Section): Table {
  let header: string[] | null = null;
  let headerIdx = -1;
  let lastIdx = -1;
  const rows: Array<{ cells: string[]; idx: number }> = [];
  for (let i = s.start + 1; i < s.end; i++) {
    const line = lines[i] ?? "";
    if (fenced[i] || !line.trim().startsWith("|")) continue;
    const cells = splitRow(line);
    lastIdx = i;
    if (header === null) {
      header = cells;
      headerIdx = i;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    rows.push({ cells, idx: i });
  }
  return { header, headerIdx, rows, lastIdx };
}
