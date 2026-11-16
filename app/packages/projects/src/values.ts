// Pure value helpers shared by the field table, the schema and the parser. No file or database access.

export const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
export const SLUG = /^[a-z0-9-]+$/;
export const EMAIL = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;
export const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function normalizeId(id: string): string {
  const hex = id.replace(/-/g, "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Lower-case, `Name <a@b>` reduced to `a@b`, `+tag` stripped from the local part. Used for every address comparison. */
export function normalizeAddress(raw: string): string {
  const angle = /<([^>]+)>/.exec(raw);
  const bare = (angle?.[1] ?? raw).trim().toLowerCase();
  const at = bare.lastIndexOf("@");
  if (at < 0) return bare;
  const local = bare.slice(0, at);
  const plus = local.indexOf("+");
  return `${plus > 0 ? local.slice(0, plus) : local}${bare.slice(at)}`;
}

export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export const isTimezone = (v: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
};

export const splitList = (v: string): string[] => v.split(",").map((s) => s.trim()).filter(Boolean);
