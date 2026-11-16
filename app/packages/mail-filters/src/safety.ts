// Hard safety rules, enforced in code. `export-*` refuse a file with any error here.
import { MAX_FILTERS, checkMatchValue, overlaps } from "./match.js";
import { buildFilters } from "./filters.js";
import { LABEL_PREFIX, classIds, classesOf, matchText, skippableIds, type Issue, type IssueCode, type RulesFile } from "./model.js";

export function checkRules(file: RulesFile): Issue[] {
  const issues: Issue[] = [];
  const classes = classesOf(file);
  const known = classIds(classes);
  const skippable = skippableIds(classes);
  const add = (severity: Issue["severity"], code: IssueCode, message: string) => issues.push({ severity, code, line: null, message });

  for (const w of file.whitelist) {
    const err = checkMatchValue(w.match.kind, w.match.value);
    if (err) add("error", "bad_whitelist", `${matchText(w.match)}: ${err}`);
  }

  const seen = new Map<string, string>();
  for (const r of file.rules) {
    const id = matchText(r.match);
    const bad = checkMatchValue(r.match.kind, r.match.value);
    if (bad) add("error", "bad_criteria", `${id}: ${bad}`);
    if (!known.includes(r.category)) {
      add("error", "bad_category", `${id}: unknown category "${r.category}"`);
      continue;
    }
    if (r.label !== `${LABEL_PREFIX}/${r.category}` && !r.label.startsWith(`${LABEL_PREFIX}/${r.category}/`)) {
      add("error", "bad_label", `${id}: label "${r.label}" must be ${LABEL_PREFIX}/${r.category} or below it`);
    }
    if (!/^[A-Za-z0-9/_ -]+$/.test(r.label) || r.label.length > 100) add("error", "bad_label", `${id}: label "${r.label}" has characters Gmail may refuse or is too long`);
    if (r.action === "label+skip+read") {
      if (!skippable.includes(r.category)) add("error", "skip_not_allowed", `${id}: ${r.category} mail is never archived or marked read (only ${skippable.join(" and ")} may be)`);
      if (r.match.kind === "subject") add("error", "skip_on_subject", `${id}: a subject pattern may only label; it can catch a client's mail`);
    }
    // The client whitelist always wins: no other category may touch a whitelisted sender.
    if (r.category !== "client") {
      for (const w of file.whitelist) {
        if (overlaps(r.match, w.match)) add("error", "whitelist_conflict", `${id} (${r.category}) overlaps the client whitelist entry ${matchText(w.match)}`);
      }
    }
    const prev = seen.get(id);
    if (prev === undefined) seen.set(id, r.category);
    else if (prev !== r.category) add("error", "duplicate_match", `${id} is classified both ${prev} and ${r.category}`);
    else add("warning", "duplicate_match", `${id} is listed twice (the duplicate is dropped on write)`);
  }

  const n = buildFilters(file).length;
  if (n > MAX_FILTERS) add("error", "too_many_filters", `${n} filters; Gmail keeps at most ${MAX_FILTERS} per account`);
  else if (n > MAX_FILTERS * 0.8) add("warning", "too_many_filters", `${n} filters; close to Gmail's limit of ${MAX_FILTERS}`);
  return issues;
}
