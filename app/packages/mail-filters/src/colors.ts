// Label colors: the universal palette per class, the Gmail palette, and the apply table. Pure: no file or network access.
// Gmail filters (XML or API) cannot set a label color; the color is set in the Gmail UI (or labels API, not used by default).
import { classesOf, DEFAULT_CLASSES, defaultLabel, LABEL_PREFIX, type Category, type RulesFile } from "./model";

export interface PaletteColor {
  /** Our name for the swatch (Gmail's menu shows swatches; the hex pair is the identity). */
  name: string;
  /** Background hex, lowercase. */
  bg: string;
  /** Text hex, lowercase. */
  text: string;
}

/** Subset of the Gmail label palette (classic swatches; the labels API accepts these hex pairs). Hex is confirmed at apply time. */
export const GMAIL_PALETTE: readonly PaletteColor[] = [
  { name: "Green", bg: "#16a766", text: "#ffffff" },
  { name: "Dark green", bg: "#0b804b", text: "#ffffff" },
  { name: "Light green", bg: "#b9e4d0", text: "#000000" },
  { name: "Blue", bg: "#4a86e8", text: "#ffffff" },
  { name: "Dark blue", bg: "#285bac", text: "#ffffff" },
  { name: "Light blue", bg: "#c9daf8", text: "#000000" },
  { name: "Light cyan", bg: "#98d7e4", text: "#0d3b44" },
  { name: "Red", bg: "#fb4c2f", text: "#ffffff" },
  { name: "Dark red", bg: "#cc3a21", text: "#ffffff" },
  { name: "Orange", bg: "#ffad47", text: "#000000" },
  { name: "Yellow", bg: "#fad165", text: "#000000" },
  { name: "Muted yellow", bg: "#f2c960", text: "#000000" },
  { name: "Purple", bg: "#a479e2", text: "#ffffff" },
  { name: "Dark purple", bg: "#8e63ce", text: "#ffffff" },
  { name: "Pink", bg: "#f691b3", text: "#000000" },
  { name: "Silver", bg: "#cccccc", text: "#000000" },
  { name: "Light gray", bg: "#e7e7e7", text: "#464646" },
  { name: "Gray", bg: "#666666", text: "#ffffff" },
  { name: "Dark gray", bg: "#434343", text: "#ffffff" },
];

/** Default per class of the generic kind: the color says where the mail comes from, every project the same. A kind's other classes carry their own `color` (kinds.ts). */
export const DEFAULT_COLORS: Readonly<Record<Category, string>> = Object.fromEntries(DEFAULT_CLASSES.map((c) => [c.id, c.color]));

export const findColor = (name: string): PaletteColor | undefined => GMAIL_PALETTE.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());

export interface ColorRow {
  label: string;
  category: Category | null;
  color: PaletteColor;
  source: "default" | "project";
}

/** Class -> color: the project's overrides on top of the universal palette. Unknown names fall back to the default. */
export function effectiveColors(file: RulesFile): Map<Category, { color: PaletteColor; source: "default" | "project" }> {
  const out = new Map<Category, { color: PaletteColor; source: "default" | "project" }>();
  for (const k of classesOf(file)) {
    const c = k.id;
    const own = file.colors?.[c] ? findColor(file.colors[c] as string) : undefined;
    out.set(c, own ? { color: own, source: "project" } : { color: (findColor(k.color) ?? findColor("Silver")) as PaletteColor, source: "default" });
  }
  return out;
}

/** The "label -> color" table: every class label, then any nested label from the rules (hub/service/ci takes its class color). */
export function colorTable(file: RulesFile): ColorRow[] {
  const eff = effectiveColors(file);
  const rows: ColorRow[] = classesOf(file).map((k) => ({ label: defaultLabel(k.id), category: k.id, ...(eff.get(k.id) as { color: PaletteColor; source: "default" | "project" }) }));
  const seen = new Set(rows.map((r) => r.label));
  for (const r of file.rules) {
    if (seen.has(r.label) || !r.label.startsWith(`${LABEL_PREFIX}/`)) continue;
    seen.add(r.label);
    const own = eff.get(r.category);
    if (own) rows.push({ label: r.label, category: r.category, ...own });
  }
  return rows;
}
